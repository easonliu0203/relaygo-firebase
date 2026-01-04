const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getAuth } = require('firebase-admin/auth');
const { SttService } = require('../services/sttService');
const Busboy = require('busboy');

// 定義 Secret
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * STT 端點（HTTPS）
 * 輸入：音訊檔案（multipart/form-data）+ language 參數
 * 輸出：{ text, language, duration }
 * 
 * 流程：
 * 1. 驗證 Firebase Auth Token
 * 2. 解析 multipart/form-data（音訊檔案）
 * 3. 驗證請求參數
 * 4. 調用 OpenAI Whisper API
 * 5. 返回轉錄文字
 */
exports.stt = onRequest(
  {
    secrets: [openaiApiKey],
    region: 'asia-east1',
    maxInstances: 10, // 限制最大實例數，防止成本失控
    timeoutSeconds: 300, // 增加到 5 分鐘，避免上傳大檔案時超時
    memory: '1GiB', // 增加記憶體以處理大音訊檔案
    cors: true, // 啟用 CORS
  },
  async (req, res) => {
    console.log('[STT] Request received:', {
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

      const { audioBuffer, language, filename } = await parseMultipartFormData(req);

      console.log('[STT] Multipart data parsed:', {
        hasAudioBuffer: !!audioBuffer,
        audioSize: audioBuffer?.length || 0,
        language,
        filename,
      });

      // 3. 驗證請求參數
      if (!audioBuffer || audioBuffer.length === 0) {
        console.error('[STT] Missing or empty audio file');
        res.status(400).json({ error: 'Bad Request: Missing or empty audio file' });
        return;
      }

      if (!language || typeof language !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "language" parameter' });
        return;
      }

      // 支援的語言列表
      const supportedLanguages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'th', 'ms', 'id'];
      if (!supportedLanguages.includes(language)) {
        res.status(400).json({
          error: 'Bad Request: Unsupported language',
          supportedLanguages
        });
        return;
      }

      console.log(`[STT] Request from user ${decodedToken.uid}: language=${language}, audioSize=${audioBuffer.length} bytes, filename=${filename}`);

      // 4. 調用 OpenAI Whisper API
      const sttService = new SttService(openaiApiKey.value());
      const result = await sttService.transcribe(audioBuffer, language, filename);

      // 5. 返回轉錄文字
      res.status(200).json({
        text: result.text,
        language: result.language,
        duration: result.duration,
        userId: decodedToken.uid,
      });

      console.log(`[STT] Successfully transcribed audio for user ${decodedToken.uid}, text="${result.text.substring(0, 100)}..."`);

    } catch (error) {
      console.error('STT error:', error);

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
 * @returns {Promise<{audioBuffer: Buffer, language: string, filename: string}>}
 */
function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let audioBuffer = null;
    let language = null;
    let filename = 'audio.m4a';

    // 處理檔案上傳
    busboy.on('file', (fieldname, file, info) => {
      console.log(`[STT] Receiving file: fieldname=${fieldname}, filename=${info.filename}, mimeType=${info.mimeType}`);

      if (fieldname === 'audio') {
        filename = info.filename || 'audio.m4a';
        const chunks = [];

        file.on('data', (chunk) => {
          chunks.push(chunk);
        });

        file.on('end', () => {
          audioBuffer = Buffer.concat(chunks);
          console.log(`[STT] File received: ${audioBuffer.length} bytes`);
        });
      } else {
        // 忽略其他檔案
        file.resume();
      }
    });

    // 處理表單欄位
    busboy.on('field', (fieldname, value) => {
      console.log(`[STT] Receiving field: ${fieldname}=${value}`);

      if (fieldname === 'language') {
        language = value;
      }
    });

    // 解析完成
    busboy.on('finish', () => {
      console.log('[STT] Multipart parsing finished');
      resolve({ audioBuffer, language, filename });
    });

    // 錯誤處理
    busboy.on('error', (error) => {
      console.error('[STT] Multipart parsing error:', error);
      reject(error);
    });

    // 開始解析
    // 在 Firebase Functions v2 中，需要使用 rawBody 而不是直接 pipe request
    // 因為 request body 可能已經被 Express 中間件讀取過了
    if (req.rawBody) {
      // 如果有 rawBody，直接使用它
      busboy.end(req.rawBody);
    } else {
      // 否則使用 pipe（向後兼容）
      req.pipe(busboy);
    }
  });
}

