# 翻譯快取清除指南

**目的**: 清除舊的直譯快取，以便使用新的母語化 prompt 重新翻譯

---

## 🔍 問題診斷結果

### 根本原因

**快取污染**：舊的直譯結果已經被快取在 Firestore 中，即使我們更新了 System Prompt 和 User Prompt，系統仍然返回快取的舊翻譯。

### 證據

從 Firebase Functions 日誌可以看到：
```
2026-01-04T16:48:24.764196Z ? translate: Cache hit for text: "新年快樂..." -> ja
```

這表示系統直接返回了快取的翻譯，沒有使用新的 prompt。

---

## 🛠️ 解決方案

### 方案 1：使用 Firebase Console 手動清除（最簡單）

1. **打開 Firebase Console**
   - 訪問：https://console.firebase.google.com/project/ride-platform-f1676/firestore

2. **導航到 Firestore Database**
   - 點擊左側菜單的「Firestore Database」

3. **找到 translation_cache 集合**
   - 在集合列表中找到 `translation_cache`

4. **刪除集合**
   - 點擊集合右側的「⋮」（更多選項）
   - 選擇「Delete collection」
   - 確認刪除

5. **驗證**
   - 刷新頁面，確認 `translation_cache` 集合已被刪除

### 方案 2：使用 Firebase CLI（推薦）

```bash
# 1. 確保已登入 Firebase
firebase login

# 2. 選擇專案
firebase use ride-platform-f1676

# 3. 使用 Firebase Emulator 或直接在 Console 中操作
# 注意：Firebase CLI 沒有直接刪除集合的命令，建議使用 Console
```

### 方案 3：使用 Cloud Functions 清除（自動化）

創建一個臨時的 Cloud Function 來清除快取：

```javascript
// firebase/functions/src/endpoints/clearCache.js
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

exports.clearTranslationCache = onRequest(
  {
    region: 'asia-east1',
    timeoutSeconds: 540, // 9 分鐘
  },
  async (req, res) => {
    // 簡單的認證（生產環境應使用更安全的方式）
    const secret = req.query.secret;
    if (secret !== 'YOUR_SECRET_KEY') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const db = getFirestore();
      const snapshot = await db.collection('translation_cache').get();
      
      if (snapshot.empty) {
        res.status(200).json({ 
          success: true, 
          message: 'Cache is already empty',
          deletedCount: 0 
        });
        return;
      }

      // 批次刪除
      const batchSize = 500;
      let deletedCount = 0;

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = db.batch();
        const batchDocs = snapshot.docs.slice(i, i + batchSize);
        
        batchDocs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        deletedCount += batchDocs.length;
      }

      res.status(200).json({ 
        success: true, 
        message: 'Cache cleared successfully',
        deletedCount 
      });

    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
);
```

部署並調用：

```bash
# 1. 部署 function
firebase deploy --only functions:clearTranslationCache

# 2. 調用 function（替換 YOUR_SECRET_KEY）
curl "https://asia-east1-ride-platform-f1676.cloudfunctions.net/clearTranslationCache?secret=YOUR_SECRET_KEY"
```

---

## ✅ 推薦步驟（最快速）

### 步驟 1：使用 Firebase Console 清除快取

1. 訪問 Firebase Console：https://console.firebase.google.com/project/ride-platform-f1676/firestore
2. 找到 `translation_cache` 集合
3. 刪除整個集合

### 步驟 2：測試翻譯功能

使用 Flutter App 測試以下案例：

**測試案例 1: 新年祝福**
```
輸入: "新年快樂"
目標語言: 日文
預期結果: "あけましておめでとうございます"
```

**測試案例 2: 感謝表達**
```
輸入: "謝謝"
目標語言: 日文
預期結果: "ありがとうございます"
```

### 步驟 3：驗證 Firebase Functions 日誌

```bash
firebase functions:log --only translate
```

應該看到：
```
Cache miss for text: "新年快樂..." -> ja
[Translation] Translated to ja in XXXms
```

這表示系統正在使用新的 prompt 進行翻譯。

---

## 📊 預期結果

清除快取後：

1. **第一次翻譯**：
   - ❌ Cache miss（快取未命中）
   - ✅ 調用 OpenAI API
   - ✅ 使用新的母語化 prompt
   - ✅ 返回母語化翻譯結果
   - ✅ 儲存到快取

2. **第二次翻譯（相同文字）**：
   - ✅ Cache hit（快取命中）
   - ✅ 直接返回新的母語化翻譯結果

---

## ⚠️ 注意事項

1. **成本影響**：
   - 清除快取後，所有翻譯都需要重新調用 OpenAI API
   - 短期內 API 調用次數會增加
   - 建議監控 OpenAI API 使用量

2. **性能影響**：
   - 翻譯速度會暫時變慢（需要調用 API）
   - 快取重建後速度會恢復正常

3. **用戶體驗**：
   - 建議在低峰時段清除快取
   - 或者分批清除（先清除測試案例）

---

## 🔄 長期解決方案

為了避免未來再次出現這個問題，建議實作**快取版本控制**：

```javascript
// 在快取鍵中加入版本號
const CACHE_VERSION = 'v2'; // 每次更新 prompt 時增加版本號

function generateCacheKey(text, targetLang) {
  const input = `${text}|${targetLang}|${CACHE_VERSION}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}
```

這樣，當更新 prompt 時，只需要增加版本號，舊快取會自動失效。

