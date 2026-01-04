const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getAuth } = require('firebase-admin/auth');
const { SttService } = require('../services/sttService');
const { TranslationService } = require('../services/translationService');
const TranslationCacheService = require('../services/translationCacheService');
const Busboy = require('busboy');

// 定義 Secret
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * STT + 翻譯合併端點（優化版）
 * 輸入：音訊檔案（multipart/form-data）+ sourceLang + targetLang
 * 輸出：{ text, translatedText, language, duration, cached }
 * 
 * 流程：
 * 1. 驗證 Firebase Auth Token
 * 2. 解析 multipart/form-data（音訊檔案）
 * 3. 調用 OpenAI Whisper API（STT）
 * 4. 檢查翻譯快取
 * 5. 未命中 → 調用 OpenAI API（翻譯）
 * 6. 寫入快取
 * 7. 一次性返回 STT 結果和翻譯結果
 */
exports.sttAndTranslate = onRequest(
  {
    secrets: [openaiApiKey],
    region: 'asia-east1',
    maxInstances: 10,
    timeoutSeconds: 300,
    memory: '512MiB', // 優化：平衡記憶體使用和性能
    cors: true,
  },
  async (req, res) => {
    console.log('[STT+翻譯] Request received:', {
      method: req.method,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      hasAuth: !!req.headers.authorization,
    });

    // CORS 處理
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // 1. 驗證 Firebase Auth Token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
        return;
      }

      const idToken = authHeader.split('Bearer ')[1];
      let decodedToken;
      try {
        decodedToken = await getAuth().verifyIdToken(idToken);
      } catch (error) {
        console.error('Token verification failed:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
        return;
      }

      // 2. 解析 multipart/form-data
      const contentType = req.headers['content-type'];
      if (!contentType || !contentType.includes('multipart/form-data')) {
        res.status(400).json({ error: 'Bad Request: Content-Type must be multipart/form-data' });
        return;
      }

      const { audioBuffer, sourceLang, targetLang, filename } = await parseMultipartFormData(req);

      console.log('[STT+翻譯] Multipart data parsed:', {
        hasAudioBuffer: !!audioBuffer,
        audioSize: audioBuffer?.length || 0,
        sourceLang,
        targetLang,
        filename,
      });

      // 3. 驗證請求參數
      if (!audioBuffer || audioBuffer.length === 0) {
        console.error('[STT+翻譯] Missing or empty audio file');
        res.status(400).json({ error: 'Bad Request: Missing or empty audio file' });
        return;
      }

      if (!sourceLang || typeof sourceLang !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "sourceLang" parameter' });
        return;
      }

      if (!targetLang || typeof targetLang !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "targetLang" parameter' });
        return;
      }

      // 支援的語言列表
      const supportedLanguages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'th', 'ms', 'id', 'zh-CN', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'bn', 'pa', 'jv', 'sw', 'te', 'mr', 'ta', 'ur'];
      if (!supportedLanguages.includes(sourceLang)) {
        res.status(400).json({
          error: 'Bad Request: Unsupported source language',
          supportedLanguages
        });
        return;
      }

      if (!supportedLanguages.includes(targetLang)) {
        res.status(400).json({
          error: 'Bad Request: Unsupported target language',
          supportedLanguages
        });
        return;
      }

      console.log(`[STT+翻譯] Request from user ${decodedToken.uid}: sourceLang=${sourceLang}, targetLang=${targetLang}, audioSize=${audioBuffer.length} bytes`);

      const startTime = Date.now();

      // 4. 調用 OpenAI Whisper API（STT）
      console.log('[STT+翻譯] Step 1: Calling STT service...');
      const sttService = new SttService(openaiApiKey.value());
      const sttResult = await sttService.transcribe(audioBuffer, sourceLang, filename);
      const sttDuration = Date.now() - startTime;
      console.log(`[STT+翻譯] STT completed in ${sttDuration}ms, text="${sttResult.text.substring(0, 100)}..."`);

      // 5. 檢查翻譯快取
      console.log('[STT+翻譯] Step 2: Checking translation cache...');
      const cacheService = new TranslationCacheService();
      let translatedText = await cacheService.getTranslation(sttResult.text, targetLang);
      let cached = !!translatedText;

      if (cached) {
        console.log(`[STT+翻譯] Cache hit for text: "${sttResult.text.substring(0, 50)}..." -> ${targetLang}`);
      } else {
        // 6. 快取未命中，調用翻譯 API
        console.log(`[STT+翻譯] Cache miss, calling translation service...`);
        const translationService = new TranslationService(openaiApiKey.value());
        const translationResult = await translationService.translate(
          sttResult.text,
          sourceLang,
          targetLang
        );

        if (!translationResult) {
          // 來源語言和目標語言相同，直接返回原文
          translatedText = sttResult.text;
        } else {
          translatedText = translationResult.text;
        }

        // 7. 寫入快取
        await cacheService.setTranslation(sttResult.text, targetLang, translatedText);
        console.log(`[STT+翻譯] Translation cached for future use`);
      }

      const totalDuration = Date.now() - startTime;
      console.log(`[STT+翻譯] Total processing time: ${totalDuration}ms (STT: ${sttDuration}ms, Translation: ${totalDuration - sttDuration}ms)`);

      // 8. 返回結果
      res.status(200).json({
        text: sttResult.text,              // STT 結果
        translatedText: translatedText,     // 翻譯結果
        language: sttResult.language,       // 偵測到的語言
        duration: totalDuration,            // 總處理時間
        sttDuration: sttDuration,           // STT 處理時間
        translationDuration: totalDuration - sttDuration, // 翻譯處理時間
        cached: cached,                     // 是否從快取讀取
        userId: decodedToken.uid,
      });

      console.log(`[STT+翻譯] Successfully processed for user ${decodedToken.uid}`);

    } catch (error) {
      console.error('STT+翻譯 error:', error);

      // 處理 OpenAI API 錯誤
      if (error.status === 429) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: error.headers?.['retry-after'] || 60,
        });
        return;
      }

      if (error.status === 401) {
        res.status(500).json({
          error: 'API configuration error',
          message: 'OpenAI API key is invalid or missing.',
        });
        return;
      }

      // 通用錯誤
      res.status(500).json({
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred',
      });
    }
  }
);

/**
 * 解析 multipart/form-data
 * @param {Object} req - HTTP 請求對象
 * @returns {Promise<{audioBuffer: Buffer, sourceLang: string, targetLang: string, filename: string}>}
 */
function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let audioBuffer = null;
    let sourceLang = null;
    let targetLang = null;
    let filename = 'audio.m4a';

    // 處理檔案上傳
    busboy.on('file', (fieldname, file, info) => {
      console.log(`[STT+翻譯] Receiving file: fieldname=${fieldname}, filename=${info.filename}, mimeType=${info.mimeType}`);

      if (fieldname === 'audio') {
        filename = info.filename || 'audio.m4a';
        const chunks = [];

        file.on('data', (chunk) => {
          chunks.push(chunk);
        });

        file.on('end', () => {
          audioBuffer = Buffer.concat(chunks);
          console.log(`[STT+翻譯] File received: ${audioBuffer.length} bytes`);
        });
      } else {
        // 忽略其他檔案
        file.resume();
      }
    });

    // 處理表單欄位
    busboy.on('field', (fieldname, value) => {
      console.log(`[STT+翻譯] Receiving field: ${fieldname}=${value}`);

      if (fieldname === 'sourceLang') {
        sourceLang = value;
      } else if (fieldname === 'targetLang') {
        targetLang = value;
      }
    });

    // 解析完成
    busboy.on('finish', () => {
      console.log('[STT+翻譯] Multipart parsing finished');
      resolve({ audioBuffer, sourceLang, targetLang, filename });
    });

    // 錯誤處理
    busboy.on('error', (error) => {
      console.error('[STT+翻譯] Multipart parsing error:', error);
      reject(error);
    });

    // 開始解析
    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

