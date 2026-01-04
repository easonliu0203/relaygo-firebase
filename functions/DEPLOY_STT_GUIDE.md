# Firebase Cloud Functions - STT 端點部署指南

## 📋 部署前檢查清單

### 1. 環境準備
- [ ] Node.js 20 已安裝
- [ ] Firebase CLI 已安裝（`npm install -g firebase-tools`）
- [ ] 已登入 Firebase（`firebase login`）
- [ ] 已設定 Firebase 專案（`firebase use relaygo-dev`）

### 2. Secret Manager 配置
- [ ] OpenAI API Key 已設定在 Firebase Secret Manager
- [ ] Secret 名稱為 `OPENAI_API_KEY`

### 3. 依賴安裝
- [ ] 已執行 `npm install` 安裝所有依賴
- [ ] `busboy` 套件已安裝（^1.6.0）

---

## 🚀 部署步驟

### Step 1: 安裝依賴

```bash
cd firebase/functions
npm install
```

**預期輸出**：
```
added 1 package, and audited 123 packages in 5s
```

### Step 2: 驗證 Secret Manager 配置

```bash
firebase functions:secrets:access OPENAI_API_KEY
```

**預期輸出**：
```
sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

如果 Secret 不存在，請執行：
```bash
firebase functions:secrets:set OPENAI_API_KEY
```

### Step 3: 部署 STT 端點

```bash
firebase deploy --only functions:stt
```

**預期輸出**：
```
=== Deploying to 'relaygo-dev'...

i  deploying functions
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
✔  functions: required API cloudfunctions.googleapis.com is enabled
✔  functions: required API cloudbuild.googleapis.com is enabled
i  functions: preparing codebase default for deployment
i  functions: ensuring required API artifactregistry.googleapis.com is enabled...
✔  functions: required API artifactregistry.googleapis.com is enabled
i  functions: Loading and analyzing source code for codebase default to determine what to deploy
Serving at port 8081

i  functions: preparing functions directory for uploading...
i  functions: packaged /path/to/functions (123.45 KB) for uploading
✔  functions: functions folder uploaded successfully
i  functions: updating Node.js 20 function stt(asia-east1)...
✔  functions[stt(asia-east1)] Successful update operation.
Function URL (stt(asia-east1)): https://asia-east1-relaygo-dev.cloudfunctions.net/stt

✔  Deploy complete!
```

### Step 4: 驗證部署

```bash
curl -X POST https://asia-east1-relaygo-dev.cloudfunctions.net/stt \
  -H "Authorization: Bearer <YOUR_FIREBASE_ID_TOKEN>" \
  -F "audio=@test_audio.m4a" \
  -F "language=zh-TW"
```

**預期回應**：
```json
{
  "text": "測試音訊的轉錄文字",
  "language": "zh-TW",
  "duration": 1234,
  "userId": "user_id"
}
```

---

## 🔧 部署配置

### Function 配置（`src/endpoints/stt.js`）

```javascript
exports.stt = onRequest(
  {
    secrets: [openaiApiKey],      // 綁定 Secret
    region: 'asia-east1',          // 部署區域
    maxInstances: 10,              // 最大實例數
    timeoutSeconds: 60,            // 超時時間（60 秒）
    memory: '512MiB',              // 記憶體配置
  },
  async (req, res) => {
    // ...
  }
);
```

### 成本控制

**配置說明**：
- `maxInstances: 10` - 限制最大實例數，防止成本失控
- `timeoutSeconds: 60` - 60 秒超時（Whisper API 通常在 5-10 秒內完成）
- `memory: '512MiB'` - 512MB 記憶體（處理音訊檔案需要較多記憶體）

**預估成本**：
- **Cloud Functions**: ~$0.0000004 / 次調用
- **OpenAI Whisper API**: $0.006 / 分鐘
- **總成本**: 每次調用約 $0.001（假設 10 秒錄音）

---

## 🧪 測試部署

### 1. 使用 Firebase Emulator 本地測試

```bash
firebase emulators:start --only functions
```

**預期輸出**：
```
✔  functions: Loaded functions definitions from source: stt, translate, tts.
✔  functions[asia-east1-stt]: http function initialized (http://127.0.0.1:5001/relaygo-dev/asia-east1/stt).

┌─────────────────────────────────────────────────────────────┐
│ ✔  All emulators ready! It is now safe to connect your app. │
│ i  View Emulator UI at http://127.0.0.1:4000                │
└─────────────────────────────────────────────────────────────┘

┌───────────┬────────────────┬─────────────────────────────────┐
│ Emulator  │ Host:Port      │ View in Emulator UI             │
├───────────┼────────────────┼─────────────────────────────────┤
│ Functions │ 127.0.0.1:5001 │ http://127.0.0.1:4000/functions │
└───────────┴────────────────┴─────────────────────────────────┘
```

### 2. 測試本地端點

```bash
curl -X POST http://127.0.0.1:5001/relaygo-dev/asia-east1/stt \
  -H "Authorization: Bearer <YOUR_FIREBASE_ID_TOKEN>" \
  -F "audio=@test_audio.m4a" \
  -F "language=zh-TW"
```

### 3. 查看日誌

```bash
firebase functions:log --only stt
```

---

## 🐛 常見問題排查

### 問題 1: Secret 未找到

**錯誤訊息**：
```
Error: Failed to load secret OPENAI_API_KEY
```

**解決方案**：
```bash
# 檢查 Secret 是否存在
firebase functions:secrets:access OPENAI_API_KEY

# 如果不存在，創建 Secret
firebase functions:secrets:set OPENAI_API_KEY
```

### 問題 2: 部署失敗（權限不足）

**錯誤訊息**：
```
Error: HTTP Error: 403, The caller does not have permission
```

**解決方案**：
```bash
# 確認已登入正確的 Google 帳號
firebase login

# 確認專案設定正確
firebase use relaygo-dev

# 確認帳號有 Cloud Functions 部署權限
```

### 問題 3: Busboy 套件未安裝

**錯誤訊息**：
```
Error: Cannot find module 'busboy'
```

**解決方案**：
```bash
cd firebase/functions
npm install busboy
```

### 問題 4: OpenAI API 調用失敗

**錯誤訊息**：
```
Error: OpenAI API key is invalid or missing
```

**解決方案**：
```bash
# 驗證 API Key 是否正確
firebase functions:secrets:access OPENAI_API_KEY

# 更新 API Key
firebase functions:secrets:set OPENAI_API_KEY

# 重新部署
firebase deploy --only functions:stt
```

### 問題 5: 音訊檔案過大

**錯誤訊息**：
```
Error: Audio file too large: 26214400 bytes (max: 25000000 bytes)
```

**解決方案**：
- 客戶端限制錄音時長（已實作：30 秒）
- 降低音訊品質（bitRate: 128000 → 64000）
- 使用更高效的編碼格式

---

## 📊 監控和維護

### 1. 查看 Function 日誌

```bash
# 查看最近的日誌
firebase functions:log --only stt

# 查看即時日誌
firebase functions:log --only stt --follow
```

### 2. 監控 API 使用情況

**Firebase Console**:
1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 選擇專案 `relaygo-dev`
3. 前往 **Functions** → **Dashboard**
4. 查看 `stt` 函數的調用次數、錯誤率、執行時間

**Google Cloud Console**:
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 選擇專案 `relaygo-dev`
3. 前往 **Cloud Functions** → **Metrics**
4. 查看詳細的監控數據

### 3. 設定告警

**建議告警規則**：
- 錯誤率 > 5%
- 平均執行時間 > 10 秒
- 每日調用次數 > 1000 次（成本控制）

---

## 🔄 更新部署

### 更新 STT 端點

```bash
# 修改代碼後重新部署
firebase deploy --only functions:stt
```

### 更新所有 Functions

```bash
# 部署所有 Functions（translate, tts, stt）
firebase deploy --only functions
```

### 回滾部署

```bash
# 查看部署歷史
firebase functions:list

# 回滾到上一個版本（需要在 Google Cloud Console 操作）
```

---

## ✅ 部署檢查清單

部署完成後，請確認以下項目：

- [ ] STT 端點成功部署
- [ ] Function URL 可訪問
- [ ] Secret Manager 配置正確
- [ ] 測試請求成功返回結果
- [ ] 日誌中無錯誤訊息
- [ ] 監控儀表板正常顯示數據
- [ ] 成本控制配置正確（maxInstances, timeout）

---

## 📝 部署記錄

**部署日期**: ___________  
**部署者**: ___________  
**版本**: ___________  
**Function URL**: https://asia-east1-relaygo-dev.cloudfunctions.net/stt  
**備註**: ___________

---

## 🎉 部署完成！

恭喜！STT 端點已成功部署到 Firebase Cloud Functions！

**下一步**：
1. 在 Flutter 應用中測試語音轉文字功能
2. 監控 API 使用情況和成本
3. 收集用戶反饋並優化
4. 考慮整合到即時翻譯頁面

如有任何問題，請參考 [SPEECH_TO_TEXT_IMPLEMENTATION.md](../../SPEECH_TO_TEXT_IMPLEMENTATION.md) 文檔。

