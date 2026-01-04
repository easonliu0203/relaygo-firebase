# RelayGo Firebase Services

Firebase Cloud Functions and services for the RelayGo platform.

## 🎯 功能範圍

基於 CQRS 架構，Firebase 負責以下服務：

### 核心功能
- 🔐 **用戶認證**：Firebase Authentication
- 📱 **推播通知**：Firebase Cloud Messaging (FCM)
- 💬 **即時聊天**：Firestore 即時資料庫
- 📁 **檔案儲存**：Firebase Storage（聊天相關檔案）
- 📍 **定位服務**：即時位置追蹤

### AI 服務
- 🗣️ **語音轉文字 (STT)**：Speech-to-Text 服務
- 🔊 **文字轉語音 (TTS)**：Text-to-Speech 服務
- 🌐 **AI 翻譯**：OpenAI 整合的智能翻譯服務

## 📁 專案結構

```
firebase/
├── functions/              # Cloud Functions
│   ├── src/
│   │   ├── endpoints/     # API 端點
│   │   │   ├── pushNotification.js
│   │   │   ├── stt.js
│   │   │   ├── translate.js
│   │   │   └── tts.js
│   │   └── services/      # 業務邏輯
│   │       ├── sttService.js
│   │       ├── translationService.js
│   │       └── ttsService.js
│   ├── index.js           # Functions 入口
│   └── package.json
├── firebase.json          # Firebase 配置
├── .firebaserc           # Firebase 專案設定
└── firestore.rules.backup # Firestore 安全規則備份
```

## 🚀 部署指南

### 前置需求
- Node.js 20+
- Firebase CLI: `npm install -g firebase-tools`
- Firebase 專案：`ride-platform-f1676`

### 安裝依賴
```bash
cd functions
npm install
```

### 本地測試
```bash
# 啟動 Firebase Emulator
npm run serve

# 測試 Functions
npm run shell
```

### 部署到生產環境
```bash
# 部署所有 Functions
firebase deploy --only functions

# 部署特定 Function
firebase deploy --only functions:translate
firebase deploy --only functions:stt
firebase deploy --only functions:tts
firebase deploy --only functions:pushNotification
```

### 查看日誌
```bash
firebase functions:log
```

## 🔧 環境變數設定

需要在 Firebase Console 設定以下環境變數：

```bash
# OpenAI API Key（用於翻譯和 AI 服務）
firebase functions:config:set openai.api_key="YOUR_OPENAI_API_KEY"

# 查看當前配置
firebase functions:config:get
```

## 📊 架構說明

### CQRS 架構中的角色
- **Firebase**：處理即時性需求（認證、推播、聊天、定位）
- **Supabase/PostgreSQL**：作為唯一真實數據源（訂單、支付、報表）
- **Railway Backend**：業務邏輯整合層

### 與其他服務的整合
- **Mobile App**：透過 Firebase SDK 直接連接
- **Backend API**：透過 Firebase Admin SDK 管理用戶和推播
- **Supabase**：透過 Edge Functions 同步必要資料

## 🔒 安全性

### Firestore 安全規則
安全規則已配置在 `firestore.rules.backup` 中，確保：
- 用戶只能存取自己的聊天記錄
- 推播通知需要認證
- 檔案上傳有大小和類型限制

### API Key 管理
⚠️ **重要**：絕不將以下文件提交到 Git：
- `*-firebase-adminsdk-*.json`
- `.env` 或 `.env.local`
- `.runtimeconfig.json`

## 📝 相關文件

- [推播通知部署指南](functions/DEPLOY_PUSH_NOTIFICATION_GUIDE.md)
- [語音轉文字部署指南](functions/DEPLOY_STT_GUIDE.md)

## 🔗 相關儲存庫

- [relaygo-backend](https://github.com/easonliu0203/relaygo-backend) - Railway API
- [relaygo-supabase](https://github.com/easonliu0203/relaygo-supabase) - Supabase 服務
- [relaygo-mobile](https://github.com/easonliu0203/relaygo-mobile) - Flutter 手機應用
- [relaygo-web-admin](https://github.com/easonliu0203/relaygo-web-admin) - Web 管理後台

## 📞 支援

如有問題，請聯繫開發團隊或查看 Firebase Console 的日誌。

