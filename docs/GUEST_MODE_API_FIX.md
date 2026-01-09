# Firebase Functions 遊客模式 API 修復報告

**日期**: 2026-01-09  
**目標**: 修復 Firebase Cloud Functions 的翻譯、STT、TTS 端點，支援遊客模式（無認證）訪問

---

## 🐛 問題描述

### 發現的問題

手機 APP 的遊客模式用戶嘗試使用即時翻譯功能時，收到 401 Unauthorized 錯誤：

```
I/flutter (22883): 🌐 [InstantTranslation] 響應狀態碼: 401
I/flutter (22883): 🌐 [InstantTranslation] 響應內容: {"error":"Unauthorized: Missing or invalid token"}
I/flutter (22883): ❌ [InstantTranslation] 翻譯失敗: Exception: 認證失敗，請重新登入
```

### 根本原因

Firebase Cloud Functions 的三個端點都強制要求 Firebase Auth Token：

1. **Translate 端點** (`firebase/functions/src/endpoints/translate.js`)
2. **STT 端點** (`firebase/functions/src/endpoints/stt.js`)
3. **TTS 端點** (`firebase/functions/src/endpoints/tts.js`)

所有端點都在第一步驗證中拒絕沒有 Authorization header 的請求：

```javascript
// 舊程式碼
const authHeader = req.headers.authorization;
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  return;  // ❌ 阻止遊客訪問
}
```

---

## ✅ 修復內容

### 1️⃣ Translate 端點修復

**檔案**: `firebase/functions/src/endpoints/translate.js`

**修改位置**: 第 46-67 行（認證邏輯）

**修改前**:
```javascript
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
```

**修改後**:
```javascript
// 1. 驗證 Firebase Auth Token（可選，支援遊客模式）
const authHeader = req.headers.authorization;
let decodedToken = null;
let userId = 'guest'; // 預設為遊客

if (authHeader && authHeader.startsWith('Bearer ')) {
  const idToken = authHeader.split('Bearer ')[1];
  try {
    decodedToken = await getAuth().verifyIdToken(idToken);
    userId = decodedToken.uid;
    console.log(`Authenticated user: ${userId}`);
  } catch (error) {
    console.error('Token verification failed:', error);
    // 不拋出錯誤，允許作為遊客繼續
    console.log('Falling back to guest mode');
  }
} else {
  console.log('Guest mode: No authentication token provided');
}
```

**其他修改**:
- 第 94-102 行：更新快取命中時的 userId 返回值
- 第 113-118 行：更新翻譯成功時的 userId 返回值

---

### 2️⃣ STT 端點修復

**檔案**: `firebase/functions/src/endpoints/stt.js`

**修改位置**: 第 54-75 行（認證邏輯）

**修改內容**: 與 Translate 端點相同的修改模式

**其他修改**:
- 第 113 行：更新日誌輸出的 userId
- 第 120-124 行：更新返回結果的 userId
- 第 127 行：更新成功日誌的 userId

---

### 3️⃣ TTS 端點修復

**檔案**: `firebase/functions/src/endpoints/tts.js`

**修改位置**: 第 44-65 行（認證邏輯）

**修改內容**: 與 Translate 端點相同的修改模式

**其他修改**:
- 第 98 行：更新日誌輸出的 userId
- 第 110 行：更新成功日誌的 userId

---

## 🎯 功能特性

### 認證模式

✅ **遊客模式**:
- 不需要 Authorization header
- userId 設為 `'guest'`
- 可以正常使用所有翻譯功能

✅ **已登入模式**:
- 提供有效的 Authorization header
- userId 設為實際的 Firebase UID
- 可以追蹤用戶使用記錄

✅ **Token 驗證失敗處理**:
- 如果提供了 Token 但驗證失敗
- 自動降級為遊客模式
- 不會拋出錯誤，確保功能可用

---

## 🔒 安全性考量

### 速率限制

建議在 Firebase Functions 配置中添加速率限制：

```javascript
exports.translate = onRequest(
  {
    // ... 其他配置
    maxInstances: 10, // ✅ 已配置：限制最大實例數
    // 建議添加：
    // invoker: 'public', // 明確標記為公開端點
  },
  async (req, res) => {
    // ...
  }
);
```

### IP 限制

考慮在 Google Cloud Console 中配置 IP 白名單或黑名單。

### 使用量監控

- 監控 `userId: 'guest'` 的 API 調用量
- 設置警報，防止濫用
- 定期檢查 Firebase Functions 的使用統計

---

## 🧪 測試步驟

### 1. 部署 Firebase Functions

```bash
cd firebase/functions
firebase deploy --only functions:translate,functions:stt,functions:tts
```

### 2. 測試遊客模式翻譯

使用 curl 測試（不帶 Authorization header）：

```bash
curl -X POST \
  https://asia-east1-ride-platform-f1676.cloudfunctions.net/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello",
    "targetLang": "zh-TW"
  }'
```

**預期結果**:
```json
{
  "translatedText": "你好",
  "cached": false,
  "userId": "guest"
}
```

### 3. 測試已登入模式翻譯

使用 curl 測試（帶 Authorization header）：

```bash
curl -X POST \
  https://asia-east1-ride-platform-f1676.cloudfunctions.net/translate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_ID_TOKEN" \
  -d '{
    "text": "Hello",
    "targetLang": "zh-TW"
  }'
```

**預期結果**:
```json
{
  "translatedText": "你好",
  "cached": false,
  "userId": "actual_user_id"
}
```

### 4. 測試手機 APP

1. **啟動客戶端 APP**:
   ```bash
   cd mobile
   flutter run -t lib/apps/customer/main_customer.dart
   ```

2. **以遊客身分登入**

3. **進入即時翻譯頁面**

4. **測試翻譯功能**:
   - 輸入文字並翻譯
   - ✅ 應該成功翻譯，不再出現 401 錯誤

5. **測試 STT 功能**:
   - 點擊麥克風錄音
   - ✅ 應該成功轉文字並翻譯

6. **測試 TTS 功能**:
   - 點擊喇叭播放
   - ✅ 應該成功播放語音

---

## 📝 部署命令

### 部署所有修改的 Functions

```bash
cd firebase/functions
firebase deploy --only functions:translate,functions:stt,functions:tts
```

### 部署單個 Function

```bash
# 只部署 translate
firebase deploy --only functions:translate

# 只部署 stt
firebase deploy --only functions:stt

# 只部署 tts
firebase deploy --only functions:tts
```

### 查看部署日誌

```bash
firebase functions:log --only translate
firebase functions:log --only stt
firebase functions:log --only tts
```

---

## ⚠️ 注意事項

1. **成本控制**: 遊客模式可能增加 API 調用量，注意監控 OpenAI API 使用成本
2. **濫用防護**: 建議實施速率限制和 IP 限制
3. **快取策略**: 確保翻譯快取正常運作，減少重複調用
4. **日誌監控**: 定期檢查 `userId: 'guest'` 的使用模式

---

## 🚀 下一步

1. **部署 Functions**: 執行部署命令
2. **測試功能**: 驗證遊客模式正常運作
3. **監控使用**: 觀察 API 調用量和成本
4. **優化快取**: 提高快取命中率，降低成本

