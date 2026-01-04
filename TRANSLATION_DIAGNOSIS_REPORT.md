# 翻譯功能直譯問題診斷報告

**診斷日期**: 2026-01-04  
**問題**: 翻譯功能仍然進行直譯而非母語化翻譯  
**狀態**: 🔍 已診斷，待修復

---

## 🔍 問題診斷

### 根本原因

**快取污染問題**：舊的直譯結果已經被快取在 Firestore 中，即使我們更新了 System Prompt 和 User Prompt，系統仍然返回快取的舊翻譯。

### 證據

從 Firebase Functions 日誌可以看到：

```
2026-01-04T16:48:24.764196Z ? translate: Cache hit for text: "新年快樂..." -> ja
2026-01-04T17:05:36.412532Z ? translate: Cache hit for text: "新年快樂..." -> ja
```

**關鍵發現**：
- ✅ System Prompt 已正確配置（包含母語化指令）
- ✅ User Prompt 已正確配置（包含文化等價要求）
- ✅ Firebase Functions 已成功部署（2026-01-04 16:29）
- ❌ **但是舊的翻譯結果已被快取，導致新的 prompt 無法生效**

---

## 📊 快取機制分析

### 快取流程

```
1. 用戶請求翻譯 "新年快樂" → ja
2. 系統生成快取鍵：SHA256("新年快樂|ja")
3. 檢查 Firestore collection: translation_cache
4. 如果快取存在且未過期 → 直接返回快取結果（跳過 OpenAI API）
5. 如果快取不存在 → 調用 OpenAI API → 儲存到快取
```

### 快取配置

- **快取位置**: Firestore collection `translation_cache`
- **快取鍵**: SHA256 hash of `${text}|${targetLang}`
- **過期時間**: 30 天
- **快取更新**: 只在快取不存在或過期時才調用 OpenAI API

### 問題

由於快取過期時間為 30 天，舊的直譯結果會持續返回，直到：
1. 快取過期（30 天後）
2. 手動清除快取

---

## 🔧 解決方案

### 方案 1：清除所有翻譯快取（推薦）

**優點**：
- ✅ 立即生效
- ✅ 確保所有翻譯都使用新的母語化 prompt
- ✅ 簡單直接

**缺點**：
- ⚠️ 短期內會增加 OpenAI API 調用次數（成本增加）
- ⚠️ 翻譯速度會暫時變慢（需要重新調用 API）

**執行步驟**：

```javascript
// 清除所有翻譯快取
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

async function clearTranslationCache() {
  const snapshot = await db.collection('translation_cache').get();
  
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  console.log(`Deleted ${snapshot.size} cached translations`);
}

clearTranslationCache();
```

### 方案 2：選擇性清除特定翻譯快取

**優點**：
- ✅ 只清除有問題的翻譯
- ✅ 減少 API 調用次數

**缺點**：
- ⚠️ 需要手動識別有問題的翻譯
- ⚠️ 可能遺漏某些直譯結果

**執行步驟**：

```javascript
// 清除特定文字的翻譯快取
const crypto = require('crypto');

function generateCacheKey(text, targetLang) {
  const input = `${text}|${targetLang}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function clearSpecificCache(text, targetLang) {
  const cacheKey = generateCacheKey(text, targetLang);
  await db.collection('translation_cache').doc(cacheKey).delete();
  console.log(`Deleted cache for: "${text}" -> ${targetLang}`);
}

// 清除測試案例的快取
await clearSpecificCache('新年快樂', 'ja');
await clearSpecificCache('謝謝', 'ja');
await clearSpecificCache('吃飽了嗎？', 'ja');
```

### 方案 3：添加快取版本控制（長期方案）

**優點**：
- ✅ 未來更新 prompt 時可以自動失效舊快取
- ✅ 更靈活的快取管理

**缺點**：
- ⚠️ 需要修改程式碼
- ⚠️ 需要重新部署

**實作方式**：

```javascript
// 在快取鍵中加入版本號
function generateCacheKey(text, targetLang, version = 'v2') {
  const input = `${text}|${targetLang}|${version}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

// 當更新 prompt 時，只需要增加版本號
const CACHE_VERSION = 'v2'; // 從 v1 改為 v2
```

---

## 🎯 建議執行步驟

### 立即行動（方案 1）

1. **清除所有翻譯快取**
2. **測試翻譯功能**
3. **驗證母語化效果**

### 長期優化（方案 3）

1. **實作快取版本控制**
2. **重新部署 Firebase Functions**
3. **建立快取管理工具**

---

## 📝 測試計劃

清除快取後，執行以下測試：

### 測試案例 1: 新年祝福
```
輸入: "新年快樂"
目標語言: ja
預期結果: "あけましておめでとうございます"
禁止結果: "新年おめでとうございます"
```

### 測試案例 2: 感謝表達
```
輸入: "謝謝"
目標語言: ja
預期結果: "ありがとうございます"
禁止結果: "感謝します"
```

### 測試案例 3: 文化問候
```
輸入: "吃飽了嗎？"
目標語言: ja
預期結果: "お元気ですか？" 或 "調子はどうですか？"
禁止結果: "食べましたか？"
```

---

## 📊 預期結果

清除快取後：
- ✅ 所有翻譯都會調用 OpenAI API
- ✅ 使用新的母語化 prompt
- ✅ 翻譯結果符合文化等價標準
- ✅ 新的翻譯結果會被快取（使用新 prompt 生成）

---

## ⚠️ 注意事項

1. **成本影響**：清除快取後，短期內 OpenAI API 調用次數會增加
2. **性能影響**：翻譯速度會暫時變慢（需要重新調用 API）
3. **監控建議**：清除快取後，監控 OpenAI API 使用量和成本

