const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getAuth } = require('firebase-admin/auth');
const { TtsService } = require('../services/ttsService');

// 定義 Secret
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * TTS 端點（HTTPS）
 * 輸入：{ text, language }
 * 輸出：音訊檔案（MP3 格式）
 * 
 * 流程：
 * 1. 驗證 Firebase Auth Token
 * 2. 驗證請求參數
 * 3. 調用 OpenAI TTS API
 * 4. 返回音訊檔案
 */
exports.tts = onRequest(
  {
    secrets: [openaiApiKey],
    region: 'asia-east1',
    maxInstances: 10, // 限制最大實例數，防止成本失控
    timeoutSeconds: 60,
    memory: '512MiB', // TTS 需要更多記憶體
  },
  async (req, res) => {
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
      // 1. 驗證 Firebase Auth Token（可選，支援遊客模式）
      const authHeader = req.headers.authorization;
      let decodedToken = null;
      let userId = 'guest'; // 預設為遊客

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
          decodedToken = await getAuth().verifyIdToken(idToken);
          userId = decodedToken.uid;
          console.log(`[TTS] Authenticated user: ${userId}`);
        } catch (error) {
          console.error('[TTS] Token verification failed:', error);
          // 不拋出錯誤，允許作為遊客繼續
          console.log('[TTS] Falling back to guest mode');
        }
      } else {
        console.log('[TTS] Guest mode: No authentication token provided');
      }

      // 2. 驗證請求參數
      const { text, language } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "text" parameter' });
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

      // 檢查文字長度（OpenAI TTS API 限制為 4096 字元）
      if (text.length > 4096) {
        res.status(400).json({
          error: 'Bad Request: Text too long',
          maxLength: 4096,
          actualLength: text.length,
        });
        return;
      }

      console.log(`[TTS] Request from user ${userId}: language=${language}, textLength=${text.length}`);

      // 3. 調用 OpenAI TTS API
      const ttsService = new TtsService(openaiApiKey.value());
      const audioBuffer = await ttsService.generateSpeech(text, language);

      // 4. 返回音訊檔案
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', audioBuffer.length.toString());
      res.set('Content-Disposition', 'attachment; filename="speech.mp3"');
      res.status(200).send(audioBuffer);

      console.log(`[TTS] Successfully generated speech for user ${userId}, size=${audioBuffer.length} bytes`);

    } catch (error) {
      console.error('TTS error:', error);

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

