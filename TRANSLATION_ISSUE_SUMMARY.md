# 翻譯功能直譯問題 - 完整診斷與修復方案

**診斷日期**: 2026-01-04  
**問題**: 翻譯功能仍然進行直譯而非母語化翻譯  
**狀態**: ✅ 已診斷，修復方案已提供

---

## 🔍 問題診斷

### 用戶報告的問題

**實例**：
- 輸入：「新年快樂」
- 當前輸出：「新年おめでとうございます」（❌ 直譯）
- 期望輸出：「あけましておめでとうございます」（✅ 母語化）

### 診斷過程

#### 1. 檢查 System Prompt 配置 ✅

<augment_code_snippet path="firebase/functions/src/services/translationService.js" mode="EXCERPT">
````javascript
content: `🎯 ROLE: You are a world-renowned simultaneous interpreter with 20+ years 
of experience in cultural equivalence translation. Your expertise is making 
translations sound EXACTLY like a native speaker wrote them, not like a translation.

🚨 CRITICAL MISSION: Your translations must be INDISTINGUISHABLE from text written 
by a native speaker of the target language. Literal translations are considered FAILURES.
````
</augment_code_snippet>

**結論**: ✅ System Prompt 配置正確，包含完整的母語化指令

#### 2. 檢查 User Prompt 配置 ✅

<augment_code_snippet path="firebase/functions/src/services/translationService.js" mode="EXCERPT">
````javascript
const prompt = `🎯 TRANSLATION TASK: ${fromClause}

⚠️ CRITICAL REQUIREMENT: Translate for CULTURAL EQUIVALENCE and NATURAL EXPRESSION, NOT literal word-for-word conversion.

📋 QUICK REFERENCE EXAMPLES:

Chinese → Japanese:
- "新年快樂" → "あけましておめでとうございます" (NOT "新年おめでとうございます")
- "謝謝" → "ありがとうございます" (NOT "感謝します")
````
</augment_code_snippet>

**結論**: ✅ User Prompt 配置正確，包含具體的母語化範例

#### 3. 檢查部署狀態 ✅

```bash
firebase functions:list
```

**結果**：
```
translate │ v2 │ https │ asia-east1 │ 256 │ nodejs20
```

**結論**: ✅ Firebase Functions 已成功部署（2026-01-04 16:29）

#### 4. 檢查 Firebase Functions 日誌 ❌

```bash
firebase functions:log --only translate
```

**關鍵發現**：
```
2026-01-04T16:48:24.764196Z ? translate: Cache hit for text: "新年快樂..." -> ja
2026-01-04T17:05:36.412532Z ? translate: Cache hit for text: "新年快樂..." -> ja
```

**結論**: ❌ **問題根源：舊的直譯結果已被快取**

---

## 🎯 根本原因

### 快取污染問題

**問題描述**：
- 舊的直譯結果已經被快取在 Firestore `translation_cache` 集合中
- 快取過期時間為 30 天
- 即使更新了 System Prompt 和 User Prompt，系統仍然返回快取的舊翻譯
- **新的 prompt 無法生效，因為系統根本沒有調用 OpenAI API**

### 快取機制

```
用戶請求翻譯 "新年快樂" → ja
    ↓
生成快取鍵: SHA256("新年快樂|ja")
    ↓
檢查 Firestore: translation_cache
    ↓
如果快取存在且未過期 → 直接返回快取結果 ❌
    ↓
如果快取不存在 → 調用 OpenAI API → 儲存到快取 ✅
```

**問題**：由於快取命中，系統跳過了 OpenAI API 調用，因此新的 prompt 無法生效。

---

## 🔧 修復方案

### 方案 1：清除所有翻譯快取（推薦）

**步驟**：

1. **打開 Firebase Console**
   ```
   https://console.firebase.google.com/project/ride-platform-f1676/firestore
   ```

2. **找到 translation_cache 集合**
   - 在 Firestore Database 中找到 `translation_cache`

3. **刪除集合**
   - 點擊集合右側的「⋮」
   - 選擇「Delete collection」
   - 確認刪除

4. **驗證**
   - 刷新頁面，確認集合已被刪除

**優點**：
- ✅ 立即生效
- ✅ 確保所有翻譯都使用新的母語化 prompt
- ✅ 簡單直接，無需編寫程式碼

**缺點**：
- ⚠️ 短期內會增加 OpenAI API 調用次數
- ⚠️ 翻譯速度會暫時變慢

### 方案 2：實作快取版本控制（長期方案）

修改快取鍵生成邏輯，加入版本號：

```javascript
// firebase/functions/src/services/translationCacheService.js

const CACHE_VERSION = 'v2'; // 每次更新 prompt 時增加版本號

generateCacheKey(text, targetLang) {
  const input = `${text}|${targetLang}|${CACHE_VERSION}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}
```

**優點**：
- ✅ 未來更新 prompt 時只需增加版本號
- ✅ 舊快取自動失效
- ✅ 更靈活的快取管理

**缺點**：
- ⚠️ 需要修改程式碼並重新部署

---

## ✅ 推薦執行步驟

### 立即行動

1. **清除翻譯快取**（使用方案 1）
   - 訪問 Firebase Console
   - 刪除 `translation_cache` 集合

2. **測試翻譯功能**
   - 使用 Flutter App 測試「新年快樂」→ 日文
   - 預期結果：「あけましておめでとうございます」

3. **驗證日誌**
   ```bash
   firebase functions:log --only translate
   ```
   - 應該看到 "Cache miss" 和 "Translated to ja"

### 長期優化

1. **實作快取版本控制**（使用方案 2）
2. **重新部署 Firebase Functions**
3. **建立快取管理工具**

---

## 📊 預期結果

清除快取後：

### 第一次翻譯
```
輸入: "新年快樂"
目標語言: ja
    ↓
Cache miss（快取未命中）
    ↓
調用 OpenAI API（使用新的母語化 prompt）
    ↓
返回: "あけましておめでとうございます" ✅
    ↓
儲存到快取
```

### 第二次翻譯（相同文字）
```
輸入: "新年快樂"
目標語言: ja
    ↓
Cache hit（快取命中）
    ↓
返回: "あけましておめでとうございます" ✅
```

---

## 📝 測試計劃

清除快取後，執行以下測試：

| 測試案例 | 輸入 | 目標語言 | 預期結果 | 禁止結果 |
|---------|------|---------|---------|---------|
| 新年祝福 | 新年快樂 | ja | あけましておめでとうございます | 新年おめでとうございます |
| 感謝表達 | 謝謝 | ja | ありがとうございます | 感謝します |
| 文化問候 | 吃飽了嗎？ | ja | お元気ですか？ | 食べましたか？ |
| 英文問候 | How are you? | zh-TW | 你好嗎？ | 你怎麼樣？ |

---

## ⚠️ 注意事項

1. **成本影響**：清除快取後，短期內 OpenAI API 調用次數會增加
2. **性能影響**：翻譯速度會暫時變慢（需要重新調用 API）
3. **監控建議**：清除快取後，監控 OpenAI API 使用量和成本

---

## 📚 相關文件

- `TRANSLATION_DIAGNOSIS_REPORT.md` - 詳細診斷報告
- `CACHE_CLEAR_GUIDE.md` - 快取清除指南
- `DEPLOYMENT_SUCCESS.md` - 部署成功報告
- `TRANSLATION_VERIFICATION_REPORT.md` - 驗證報告

