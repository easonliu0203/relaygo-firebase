# Firebase Cloud Functions - 推播通知部署指南

## 📋 概述

此指南說明如何部署 Firebase Cloud Function 來監聽新聊天訊息並自動發送推播通知。

## 🎯 功能說明

### **onNewChatMessage** Cloud Function

**觸發時機**：當新訊息寫入 `chat_rooms/{roomId}/messages/{messageId}` 時

**功能流程**：
1. 監聽 Firestore `chat_rooms/{roomId}/messages/{messageId}` 的新增事件
2. 讀取訊息資料（senderId, receiverId, messageText, senderName）
3. 從 Firestore `/users/{receiverId}/fcmToken` 獲取接收者的 FCM Token
4. 使用 Firebase Admin SDK 發送推播通知到接收者的裝置
5. 記錄發送結果（成功或失敗）

**跳過條件**：
- 系統訊息（senderId === 'system'）
- 缺少 receiverId 或 messageText
- 接收者沒有 FCM Token

## 📂 檔案結構

```
firebase/functions/
├── index.js                                    # 主入口檔案（已修改）
├── src/
│   └── endpoints/
│       └── pushNotification.js                 # 推播通知 Cloud Function（新增）
├── package.json                                # 依賴配置
└── DEPLOY_PUSH_NOTIFICATION_GUIDE.md          # 本指南
```

## 🚀 部署步驟

### **步驟 1：確認 Firebase CLI 已安裝**

```bash
# 檢查 Firebase CLI 版本
firebase --version

# 如果未安裝，請安裝
npm install -g firebase-tools
```

### **步驟 2：登入 Firebase**

```bash
firebase login
```

### **步驟 3：切換到 Firebase Functions 目錄**

```bash
cd firebase/functions
```

### **步驟 4：安裝依賴**

```bash
npm install
```

### **步驟 5：部署 Cloud Functions**

```bash
# 部署所有 Functions
firebase deploy --only functions

# 或者只部署推播通知 Function
firebase deploy --only functions:onNewChatMessage
```

### **步驟 6：驗證部署**

1. 前往 Firebase Console > Functions
2. 確認 `onNewChatMessage` Function 已部署
3. 檢查 Function 的觸發器設定：
   - 類型：Cloud Firestore
   - 事件類型：onCreate
   - 文檔路徑：`chat_rooms/{roomId}/messages/{messageId}`
   - 區域：asia-east1

## 🧪 測試推播通知

### **方法 1：使用 Mobile App 發送訊息**

1. 在 Mobile App 中登入兩個不同的帳號（客戶和司機）
2. 建立一個訂單並配對
3. 在聊天室中發送訊息
4. 確認接收者收到推播通知

### **方法 2：手動寫入 Firestore**

1. 前往 Firebase Console > Firestore Database
2. 導航到 `chat_rooms/{bookingId}/messages`
3. 手動新增一個訊息文檔：
   ```json
   {
     "senderId": "sender_user_id",
     "receiverId": "receiver_user_id",
     "senderName": "測試用戶",
     "messageText": "這是一條測試訊息",
     "createdAt": "2025-11-29T12:00:00Z",
     "readAt": null
   }
   ```
4. 檢查 Firebase Console > Functions > Logs 確認 Function 被觸發
5. 確認接收者收到推播通知

### **方法 3：檢查 Function Logs**

```bash
# 查看最新的 Function 日誌
firebase functions:log --only onNewChatMessage

# 或者在 Firebase Console > Functions > onNewChatMessage > Logs 查看
```

**預期日誌輸出**：
```
[onNewChatMessage] New message created: {messageId} in room {roomId}
[onNewChatMessage] Message data: { senderId: '...', receiverId: '...', messageText: '...' }
[onNewChatMessage] Found FCM token: abc123...
[onNewChatMessage] ✅ Push notification sent successfully: projects/.../messages/...
```

## 🔧 故障排除

### **問題 1：Function 沒有被觸發**

**可能原因**：
- Function 部署失敗
- Firestore 觸發器路徑不正確
- Firebase 專案配置錯誤

**解決方案**：
1. 檢查 Function 部署狀態：`firebase deploy --only functions:onNewChatMessage`
2. 確認 Firestore 路徑：`chat_rooms/{roomId}/messages/{messageId}`
3. 檢查 Firebase Console > Functions > onNewChatMessage > Triggers

### **問題 2：推播通知沒有發送**

**可能原因**：
- 接收者沒有 FCM Token
- FCM Token 無效或過期
- Firebase Admin SDK 配置錯誤

**解決方案**：
1. 檢查 Firestore `/users/{receiverId}/fcmToken` 是否存在
2. 檢查 Function Logs 中的錯誤訊息
3. 確認 Mobile App 已正確儲存 FCM Token

### **問題 3：推播通知發送成功但沒有顯示**

**可能原因**：
- Mobile App 在前景（foreground），推播通知不會顯示
- Android/iOS 通知權限未授予
- 通知頻道（Android）配置錯誤

**解決方案**：
1. 確保 Mobile App 在背景或終止狀態
2. 檢查 Android/iOS 系統設定中的通知權限
3. 檢查 Android 通知頻道 `chat_messages` 是否正確配置

## 📊 監控和日誌

### **查看 Function 執行統計**

1. 前往 Firebase Console > Functions > onNewChatMessage
2. 查看以下指標：
   - 調用次數（Invocations）
   - 執行時間（Execution time）
   - 錯誤率（Error rate）
   - 記憶體使用（Memory usage）

### **查看詳細日誌**

```bash
# 查看最新 100 條日誌
firebase functions:log --only onNewChatMessage --limit 100

# 查看特定時間範圍的日誌
firebase functions:log --only onNewChatMessage --since 2025-11-29T00:00:00
```

## 🔐 安全性考量

1. **FCM Token 保護**：
   - FCM Token 儲存在 Firestore `/users/{userId}/fcmToken`
   - 使用 Firestore Security Rules 保護 Token 不被未授權訪問

2. **訊息驗證**：
   - Function 會跳過系統訊息（senderId === 'system'）
   - 確保只有有效的訊息才會觸發推播通知

3. **錯誤處理**：
   - Function 不會拋出錯誤，避免無限重試
   - 無效的 FCM Token 會被記錄但不會中斷流程

## 📝 後續優化建議

1. **批次處理**：
   - 如果同一個用戶在短時間內收到多條訊息，可以合併推播通知

2. **個性化通知**：
   - 根據用戶的語言偏好發送不同語言的推播通知
   - 根據用戶的通知設定（靜音時段等）調整推播行為

3. **分析和追蹤**：
   - 記錄推播通知的發送成功率
   - 追蹤用戶的推播通知點擊率

4. **清理無效 Token**：
   - 定期清理無效或過期的 FCM Token
   - 當 FCM 返回 `invalid-registration-token` 錯誤時自動清理

## 🎉 完成

部署完成後，每當有新的聊天訊息寫入 Firestore 時，接收者將自動收到推播通知！

