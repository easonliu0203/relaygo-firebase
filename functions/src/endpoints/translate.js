const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getAuth } = require('firebase-admin/auth');
const { TranslationService } = require('../services/translationService');
const TranslationCacheService = require('../services/translationCacheService');

// 定義 Secret
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * 翻譯端點（HTTPS）
 * 輸入：{ text, targetLang }
 * 輸出：{ translatedText }
 * 
 * 流程：
 * 1. 驗證 Firebase Auth Token
 * 2. 檢查快取
 * 3. 未命中 → 調用 OpenAI API
 * 4. 寫入快取
 * 5. 返回翻譯結果
 */
exports.translate = onRequest(
  {
    secrets: [openaiApiKey],
    region: 'asia-east1',
    maxInstances: 10, // 限制最大實例數，防止成本失控
    timeoutSeconds: 60,
    memory: '256MiB',
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

      // 2. 驗證請求參數
      const { text, targetLang } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "text" parameter' });
        return;
      }

      if (!targetLang || typeof targetLang !== 'string') {
        res.status(400).json({ error: 'Bad Request: Missing or invalid "targetLang" parameter' });
        return;
      }

      // 支援的語言列表
      const supportedLanguages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'th', 'ms', 'id'];
      if (!supportedLanguages.includes(targetLang)) {
        res.status(400).json({ 
          error: 'Bad Request: Unsupported target language',
          supportedLanguages 
        });
        return;
      }

      // 3. 檢查快取
      const cacheService = new TranslationCacheService();
      const cachedTranslation = await cacheService.getTranslation(text, targetLang);

      if (cachedTranslation) {
        console.log(`Cache hit for text: "${text.substring(0, 50)}..." -> ${targetLang}`);
        res.status(200).json({
          translatedText: cachedTranslation,
          cached: true,
          userId: decodedToken.uid,
        });
        return;
      }

      // 4. 快取未命中，調用 OpenAI API
      console.log(`Cache miss for text: "${text.substring(0, 50)}..." -> ${targetLang}`);
      
      const translationService = new TranslationService(openaiApiKey.value());
      const translatedText = await translationService.translateText(text, targetLang);

      // 5. 寫入快取
      await cacheService.setTranslation(text, targetLang, translatedText);

      // 6. 返回翻譯結果
      res.status(200).json({
        translatedText,
        cached: false,
        userId: decodedToken.uid,
      });

    } catch (error) {
      console.error('Translation error:', error);

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

