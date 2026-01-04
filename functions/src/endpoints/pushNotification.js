/**
 * Firebase Cloud Function for Push Notifications
 *
 * 功能：
 * 1. onNewChatMessage - 監聽新聊天訊息並發送推播通知
 *
 * 觸發時機：當新訊息寫入 chat_rooms/{roomId}/messages/{messageId} 時
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

/**
 * Cloud Function: 監聽新聊天訊息並發送推播通知
 *
 * 監聽路徑：chat_rooms/{roomId}/messages/{messageId}
 * 觸發時機：新訊息創建時
 *
 * 流程：
 * 1. 讀取訊息資料（senderId, receiverId, messageText）
 * 2. 從 Firestore 獲取接收者的 FCM Token
 * 3. 使用 Firebase Admin SDK 發送推播通知
 * 4. 記錄發送結果
 */
exports.onNewChatMessage = onDocumentCreated({
  document: 'chat_rooms/{roomId}/messages/{messageId}',
  region: 'asia-east1',
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log('[onNewChatMessage] No data associated with the event');
    return;
  }

  const messageData = snapshot.data();
  const { roomId, messageId } = event.params;

  console.log(`[onNewChatMessage] New message created: ${messageId} in room ${roomId}`);
  console.log('[onNewChatMessage] Message data:', {
    senderId: messageData.senderId,
    receiverId: messageData.receiverId,
    messageText: messageData.messageText?.substring(0, 50),
  });

  try {
    // 1. 提取訊息資料
    const senderId = messageData.senderId;
    const receiverId = messageData.receiverId;
    const messageText = messageData.messageText;
    const senderName = messageData.senderName || '用戶';

    // 跳過系統訊息
    if (senderId === 'system') {
      console.log('[onNewChatMessage] Skipping system message');
      return null;
    }

    if (!receiverId || !messageText) {
      console.log('[onNewChatMessage] Missing receiverId or messageText');
      return null;
    }

    // 2. 從 Firestore 獲取接收者的 FCM Token
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(receiverId).get();

    if (!userDoc.exists) {
      console.log('[onNewChatMessage] Receiver user document not found:', receiverId);
      return null;
    }

    const userData = userDoc.data();
    const fcmToken = userData?.fcmToken;

    if (!fcmToken) {
      console.log('[onNewChatMessage] Receiver has no FCM token:', receiverId);
      return null;
    }

    console.log('[onNewChatMessage] Found FCM token:', fcmToken.substring(0, 20) + '...');

    // 3. 構建推播訊息
    const notificationTitle = `${senderName} 發送了新訊息`;
    const notificationBody = messageText.length > 100 
      ? messageText.substring(0, 100) + '...' 
      : messageText;

    const message = {
      token: fcmToken,
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'new_message',
        chatRoomId: roomId,
        bookingId: roomId, // chatRoomId 通常就是 bookingId
        messageId: messageId,
        senderId: senderId,
        senderName: senderName,
      },
      // Android 特定配置
      android: {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          priority: 'high',
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          defaultLightSettings: true,
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      // iOS 特定配置
      apns: {
        payload: {
          aps: {
            alert: {
              title: notificationTitle,
              body: notificationBody,
            },
            sound: 'default',
            badge: 1,
            contentAvailable: true,
            category: 'MESSAGE',
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },
    };

    // 4. 發送推播通知
    const response = await admin.messaging().send(message);

    console.log('[onNewChatMessage] ✅ Push notification sent successfully:', response);

    return {
      success: true,
      messageId,
      receiverId,
      fcmResponse: response,
    };

  } catch (error) {
    console.error('[onNewChatMessage] ❌ Error sending push notification:', error);

    // 處理無效 Token 的情況
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.log('[onNewChatMessage] Invalid FCM token, cleaning up...');

      // 自動清理無效的 FCM Token
      try {
        const db = admin.firestore();
        await db.collection('users').doc(receiverId).update({
          fcmToken: admin.firestore.FieldValue.delete(),
          fcmTokenDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
          fcmTokenDeleteReason: 'Invalid or unregistered token',
        });
        console.log('[onNewChatMessage] ✅ Invalid FCM token cleaned up for user:', receiverId);
      } catch (cleanupError) {
        console.error('[onNewChatMessage] ❌ Failed to clean up invalid token:', cleanupError);
      }
    }

    // 不拋出錯誤，避免重試
    return {
      success: false,
      error: error.message,
    };
  }
});

