/**
 * Firebase Cloud Functions for Chat Translation
 *
 * 功能：
 * 1. onMessageCreate - 自動翻譯新訊息（onCreate 觸發器）- 將被移除
 * 2. translateMessage - 按需翻譯（HTTPS 端點）- 將被移除
 * 3. translate - 新的翻譯端點（HTTPS）- 按需翻譯 + Firestore 快取
 *
 * 使用 Google Cloud Secret Manager 儲存敏感資訊
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { getTranslationService } = require('./src/services/translationService');

// 初始化 Firebase Admin
admin.initializeApp();

const db = admin.firestore();

// 導出新的翻譯端點
const { translate } = require('./src/endpoints/translate');
exports.translate = translate;

// 導出推播通知觸發器
const { onNewChatMessage } = require('./src/endpoints/pushNotification');
exports.onNewChatMessage = onNewChatMessage;

// 定義 Secrets（從 Google Cloud Secret Manager 讀取）
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * Cloud Function 1: 自動翻譯（onCreate 觸發器）
 *
 * 監聽路徑：chat_rooms/{roomId}/messages/{messageId}
 * 觸發時機：新訊息創建時
 *
 * 流程：
 * 1. 讀取訊息的 text 和 lang
 * 2. 檢查是否啟用自動翻譯
 * 3. 檢查訊息長度是否符合自動翻譯條件
 * 4. 針對目標語言清單逐一翻譯
 * 5. 寫回 translations.{lang} 欄位
 */
exports.onMessageCreate = onDocumentCreated({
  document: 'chat_rooms/{roomId}/messages/{messageId}',
  region: 'asia-east1',
  secrets: [openaiApiKey], // 綁定 Secret
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log('[onMessageCreate] No data associated with the event');
    return;
  }

  const messageData = snapshot.data();
  const { roomId, messageId } = event.params;

  console.log(`[onMessageCreate] New message created: ${messageId} in room ${roomId}`);

  try {
    // 檢查是否啟用自動翻譯（默認為 true）
    const enableAutoTranslate = process.env.ENABLE_AUTO_TRANSLATE !== 'false';
    if (!enableAutoTranslate) {
      console.log('[onMessageCreate] Auto-translate is disabled');
      return null;
    }

    console.log('[onMessageCreate] Auto-translate is enabled');

    // 讀取訊息內容
    const text = messageData.messageText;
    const sourceLang = messageData.detectedLang || messageData.lang || 'zh-TW';
    const senderId = messageData.senderId;
    const receiverId = messageData.receiverId;

    if (!text) {
      console.log('[onMessageCreate] No text to translate');
      return null;
    }

    // 檢查是否已有翻譯（冪等性）
    if (messageData.translations && Object.keys(messageData.translations).length > 0) {
      console.log('[onMessageCreate] Translations already exist, skipping');
      return null;
    }

    // 獲取 OpenAI API 金鑰（從 Secret Manager）
    const apiKey = openaiApiKey.value();
    console.log('[onMessageCreate] API key retrieved from Secret Manager:', apiKey ? `${apiKey.substring(0, 20)}...` : 'N/A');

    // 檢查訊息長度
    const translationService = getTranslationService(apiKey);
    if (!translationService.shouldAutoTranslate(text)) {
      console.log(`[onMessageCreate] Message too long (${text.length} chars), skipping auto-translate`);
      return null;
    }

    // 獲取聊天室中兩個用戶的語言偏好
    const targetLanguages = [];

    try {
      // 讀取發送者和接收者的語言偏好
      const [senderDoc, receiverDoc] = await Promise.all([
        db.collection('users').doc(senderId).get(),
        db.collection('users').doc(receiverId).get(),
      ]);

      const senderLang = senderDoc.exists ? (senderDoc.data().preferredLang || 'zh-TW') : 'zh-TW';
      const receiverLang = receiverDoc.exists ? (receiverDoc.data().preferredLang || 'zh-TW') : 'zh-TW';

      console.log(`[onMessageCreate] Sender language: ${senderLang}, Receiver language: ${receiverLang}`);

      // 只翻譯接收者的語言（如果與來源語言不同）
      if (receiverLang !== sourceLang && !targetLanguages.includes(receiverLang)) {
        targetLanguages.push(receiverLang);
      }

      // 可選：也翻譯成英文作為後備（如果兩個用戶都不是英文）
      if (sourceLang !== 'en' && receiverLang !== 'en' && !targetLanguages.includes('en')) {
        targetLanguages.push('en');
      }
    } catch (error) {
      console.error('[onMessageCreate] Error fetching user language preferences:', error);
      // 如果無法獲取用戶語言偏好，使用預設值（英文）
      if (sourceLang !== 'en') {
        targetLanguages.push('en');
      }
    }

    if (targetLanguages.length === 0) {
      console.log('[onMessageCreate] No translation needed (sender and receiver use same language)');
      return null;
    }

    console.log(`[onMessageCreate] Translating to: ${targetLanguages.join(', ')}`);

    // 批次翻譯
    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_TRANSLATIONS || '2');
    const translations = await translationService.translateBatch(
      text,
      sourceLang,
      targetLanguages,
      maxConcurrent
    );

    // 決定要顯示的翻譯文字（優先順序：en > ja > 第一個可用的翻譯）
    let translatedText = null;
    if (translations.en && translations.en.text) {
      translatedText = translations.en.text;
    } else if (translations.ja && translations.ja.text) {
      translatedText = translations.ja.text;
    } else {
      // 使用第一個可用的翻譯
      const firstLang = Object.keys(translations)[0];
      if (firstLang && translations[firstLang].text) {
        translatedText = translations[firstLang].text;
      }
    }

    // 寫回 Firestore
    await snapshot.ref.update({
      translations,
      translatedText, // 設置 translatedText 欄位供 Flutter App 使用
      translatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[onMessageCreate] Successfully translated to ${Object.keys(translations).length} languages`);
    console.log(`[onMessageCreate] translatedText set to: ${translatedText ? translatedText.substring(0, 50) : 'null'}...`);

    return {
      success: true,
      messageId,
      translatedLanguages: Object.keys(translations),
    };

  } catch (error) {
    console.error('[onMessageCreate] Error:', error);

    // 記錄錯誤到 Firestore（可選）
    await snapshot.ref.update({
      translationError: {
        message: error.message,
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    // 不拋出錯誤，避免重試
    return {
      success: false,
      error: error.message,
    };
  }
});

/**
 * Cloud Function 2: 按需翻譯（HTTPS 端點）
 *
 * 端點：POST /translateMessage
 * 認證：需要 Firebase ID Token
 *
 * 請求體：
 * {
 *   "roomId": "string",
 *   "messageId": "string",
 *   "targetLang": "string"
 * }
 *
 * 回應：
 * {
 *   "success": true,
 *   "translation": {
 *     "text": "string",
 *     "model": "string",
 *     "at": "timestamp"
 *   }
 * }
 */
exports.translateMessage = onRequest({
  region: 'asia-east1',
  secrets: [openaiApiKey], // 綁定 Secret
  cors: true,
}, async (req, res) => {
    // CORS 已在 onRequest 配置中處理
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed' });
      return;
    }

    try {
      // 驗證 Firebase ID Token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Unauthorized: Missing token' });
        return;
      }

      const idToken = authHeader.split('Bearer ')[1];
      let decodedToken;
      
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        console.error('[translateMessage] Token verification failed:', error);
        res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
        return;
      }

      const userId = decodedToken.uid;
      console.log(`[translateMessage] Request from user: ${userId}`);

      // 解析請求體
      const { roomId, messageId, targetLang } = req.body;

      if (!roomId || !messageId || !targetLang) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: roomId, messageId, targetLang',
        });
        return;
      }

      // 查詢訊息
      const messageRef = db.collection('chat_rooms').doc(roomId).collection('messages').doc(messageId);
      const messageDoc = await messageRef.get();

      if (!messageDoc.exists) {
        res.status(404).json({ success: false, error: 'Message not found' });
        return;
      }

      const messageData = messageDoc.data();

      // 驗證用戶是否為聊天室成員
      const roomRef = db.collection('chat_rooms').doc(roomId);
      const roomDoc = await roomRef.get();

      if (!roomDoc.exists) {
        res.status(404).json({ success: false, error: 'Chat room not found' });
        return;
      }

      const roomData = roomDoc.data();
      if (roomData.customerId !== userId && roomData.driverId !== userId) {
        res.status(403).json({ success: false, error: 'Forbidden: Not a member of this chat room' });
        return;
      }

      // 檢查是否已有該語言的翻譯
      if (messageData.translations && messageData.translations[targetLang]) {
        console.log(`[translateMessage] Translation already exists for ${targetLang}`);
        res.status(200).json({
          success: true,
          translation: messageData.translations[targetLang],
          cached: true,
        });
        return;
      }

      // 執行翻譯
      const text = messageData.messageText;
      const sourceLang = messageData.lang || 'zh-TW';

      // 獲取 OpenAI API 金鑰（從 Secret Manager）
      const apiKey = openaiApiKey.value();

      const translationService = getTranslationService(apiKey);
      const translation = await translationService.translate(text, sourceLang, targetLang);

      if (!translation) {
        res.status(400).json({
          success: false,
          error: 'Translation skipped: source and target languages are the same',
        });
        return;
      }

      // 決定是否更新 translatedText（如果翻譯的是英文或日文）
      const updateData = {
        [`translations.${targetLang}`]: translation,
        translatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // 如果翻譯的是英文，更新 translatedText
      if (targetLang === 'en') {
        updateData.translatedText = translation.text;
      }
      // 如果翻譯的是日文，且目前沒有 translatedText，則使用日文翻譯
      else if (targetLang === 'ja' && !messageData.translatedText) {
        updateData.translatedText = translation.text;
      }

      // 寫回 Firestore
      await messageRef.update(updateData);

      console.log(`[translateMessage] Successfully translated message ${messageId} to ${targetLang}`);

      res.status(200).json({
        success: true,
        translation,
        cached: false,
      });

    } catch (error) {
      console.error('[translateMessage] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error',
      });
    }
  });

