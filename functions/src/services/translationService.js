/**
 * Translation Service
 *
 * 負責與 OpenAI API 互動，執行文字翻譯
 * 包含錯誤處理、重試邏輯、成本控制
 *
 * 使用 Google Cloud Secret Manager 儲存 API 金鑰
 */

const OpenAI = require('openai');
const admin = require('firebase-admin');

class TranslationService {
  /**
   * @param {string} apiKey - OpenAI API 金鑰（從 Secret Manager 傳入）
   */
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
    });

    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '500');
    // 提高 temperature 以獲得更自然、更有創造性的翻譯
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7');
    this.maxRetries = parseInt(process.env.MAX_RETRY_ATTEMPTS || '2');
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS || '1000');

    // 翻譯快取（使用 Firestore 或 Memory）
    this.cache = new Map();
    this.cacheTTL = parseInt(process.env.TRANSLATION_CACHE_TTL || '600') * 1000;
  }

  /**
   * 翻譯文字（簡化版本，自動偵測來源語言）
   * @param {string} text - 原文
   * @param {string} targetLang - 目標語言（ISO 碼）
   * @returns {Promise<string>} - 翻譯後的文字
   */
  async translateText(text, targetLang) {
    // 使用 'auto' 作為來源語言，讓 OpenAI 自動偵測
    const result = await this.translate(text, 'auto', targetLang);
    return result ? result.text : text;
  }

  /**
   * 翻譯文字
   * @param {string} text - 原文
   * @param {string} sourceLang - 來源語言（ISO 碼，可使用 'auto' 自動偵測）
   * @param {string} targetLang - 目標語言（ISO 碼）
   * @returns {Promise<{text: string, model: string, at: Date}>}
   */
  async translate(text, sourceLang, targetLang) {
    // 語言自動偵測：如果來源語言等於目標語言，跳過翻譯
    if (sourceLang === targetLang) {
      console.log(`[Translation] Skipping translation: source and target are the same (${sourceLang})`);
      return null;
    }

    // 檢查快取
    const cacheKey = this.getCacheKey(text, targetLang);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[Translation] Cache hit for ${targetLang}`);
      return cached;
    }

    // 執行翻譯（帶重試）
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.translateWithOpenAI(text, sourceLang, targetLang);
        
        // 寫入快取
        this.setCache(cacheKey, result);
        
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[Translation] Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          // 指數退避
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.log(`[Translation] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // 所有重試都失敗
    throw new Error(`Translation failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * 使用 OpenAI API 翻譯
   */
  async translateWithOpenAI(text, sourceLang, targetLang) {
    const languageNames = {
      'zh-TW': '繁體中文',
      'en': 'English',
      'ja': '日本語',
      'ko': '한국어',
      'th': 'ไทย',
      'vi': 'Tiếng Việt',
      'id': 'Bahasa Indonesia',
      'ms': 'Bahasa Melayu',
      'auto': 'the source language (auto-detect)',
    };

    const targetLangName = languageNames[targetLang] || targetLang;
    const sourceLangName = languageNames[sourceLang] || sourceLang;

    // ✅ 修改 prompt：要求自然母語表達，而非逐字直譯
    // 如果來源語言是 'auto'，讓 OpenAI 自動偵測
    const fromClause = sourceLang === 'auto'
      ? `Translate the following text to ${targetLangName}`
      : `Translate the following text from ${sourceLangName} to ${targetLangName}`;

    const prompt = `🚨 FORBIDDEN: Do NOT translate literally. You MUST use natural ${targetLangName} expressions.

${fromClause}.

⚠️ CRITICAL INSTRUCTION: Translate for CULTURAL MEANING and NATURAL EXPRESSION, NOT word-for-word.

🔴 ABSOLUTE REQUIREMENTS (MUST FOLLOW):
1. 🚫 FORBIDDEN: Literal/word-for-word translations that sound unnatural
2. ✅ REQUIRED: Use EXACT expressions that native ${targetLangName} speakers use daily
3. ✅ REQUIRED: For greetings/celebrations/idioms, use the CULTURAL EQUIVALENT
4. ✅ REQUIRED: Output must sound like a native speaker wrote it
5. ✅ REQUIRED: Natural expression > Literal accuracy (ALWAYS)

🎯 SPECIFIC EXAMPLES - FOLLOW THESE PATTERNS:

If translating "新年快樂" to Japanese:
- ❌ WRONG (literal): "新年おめでとうございます"
- ✅ CORRECT (natural): "あけましておめでとうございます"
- Reason: Japanese people say "あけまして..." for New Year

If translating "謝謝" to Japanese:
- ❌ WRONG (literal): "感謝します"
- ✅ CORRECT (natural): "ありがとうございます"
- Reason: "ありがとう..." is the natural way to say thanks

If translating "How are you?" to Chinese:
- ❌ WRONG (literal): "你怎麼樣？"
- ✅ CORRECT (natural): "你好嗎？" or "最近怎麼樣？"

🎯 YOUR TASK:
1. Understand the MEANING and CULTURAL CONTEXT (not just words)
2. Think: "What would a native ${targetLangName} speaker say in this situation?"
3. Use that natural expression (even if completely different from literal translation)

⚠️ FINAL WARNING: If your translation sounds unnatural or literal, it's WRONG. Use what native speakers actually say!

OUTPUT FORMAT: Only return the translated text. No explanations, notes, or additional content.

Text to translate: ${text}`;

    const startTime = Date.now();

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            // ✅ 修改 system prompt：強調自然母語表達和文化適應
            content: `🚨 CRITICAL INSTRUCTION: You are FORBIDDEN from producing literal/word-for-word translations. You MUST produce culturally authentic translations that native speakers actually use.

You are a world-class translator specializing in CULTURALLY AUTHENTIC, NATURAL translations.

🎯 YOUR PRIMARY GOAL: Produce translations that native speakers would actually use in real conversations.

⚠️ ABSOLUTE RULES (VIOLATION = FAILURE):
1. 🚫 NEVER translate word-for-word or literally - this is FORBIDDEN
2. 🚫 NEVER use unnatural expressions that native speakers don't use
3. ✅ ALWAYS use the EXACT phrases that native speakers use in daily life
4. ✅ For greetings, celebrations, idioms: Find the CULTURAL EQUIVALENT (not literal translation)
5. ✅ Your output must be INDISTINGUISHABLE from text written by a native speaker
6. ✅ Cultural appropriateness > Literal accuracy (ALWAYS)

🔴 CRITICAL EXAMPLES - STUDY THESE CAREFULLY:

Example 1: Chinese New Year Greeting → Japanese
- Input: "新年快樂"
- ❌ FORBIDDEN (literal): "新年おめでとうございます"
- ✅ REQUIRED (natural): "あけましておめでとうございます"
- Why: Japanese people say "あけましておめでとうございます" for New Year, NOT "新年おめでとうございます"

Example 2: Chinese Thanks → Japanese
- Input: "謝謝"
- ❌ FORBIDDEN (literal): "感謝します"
- ✅ REQUIRED (natural): "ありがとうございます"
- Why: "ありがとうございます" is what Japanese people actually say

Example 3: English Greeting → Chinese
- Input: "How are you?"
- ❌ FORBIDDEN (literal): "你怎麼樣？"
- ✅ REQUIRED (natural): "你好嗎？" or "最近怎麼樣？"

🎯 TRANSLATION STRATEGY:
1. Identify the MEANING and CULTURAL CONTEXT (not just words)
2. Think: "What would a native speaker say in this situation?"
3. Use that natural expression (even if it's completely different from the literal translation)

REMEMBER: Literal translation = WRONG. Natural expression = CORRECT. If a native speaker wouldn't say it, DON'T use it.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      const duration = Date.now() - startTime;
      const translatedText = response.choices[0].message.content.trim();

      console.log(`[Translation] Translated to ${targetLang} in ${duration}ms`);
      console.log(`[Translation] Tokens used: ${response.usage.total_tokens}`);

      return {
        text: translatedText,
        model: this.model,
        at: admin.firestore.Timestamp.now(),
        tokensUsed: response.usage.total_tokens,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      // 詳細的錯誤日誌 - 記錄完整的錯誤對象
      console.error(`[Translation] Error after ${duration}ms:`, {
        status: error.status,
        code: error.code,
        message: error.message,
        type: error.type,
        name: error.name,
        // 記錄完整的錯誤對象以便診斷
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });

      // 分類錯誤並提供清晰的訊息
      let errorMessage = 'Unknown error';

      if (error.status === 429) {
        errorMessage = 'OpenAI API quota exceeded. Please check billing at https://platform.openai.com/account/billing';
      } else if (error.status === 401 || error.status === 403) {
        errorMessage = 'OpenAI API authentication failed. Please check API key.';
      } else if (error.status === 503 || error.status === 500) {
        errorMessage = 'OpenAI API is temporarily unavailable. Please retry later.';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'DNS resolution failed. Check network connectivity.';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused. OpenAI API may be down.';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Request timeout. Network may be slow.';
      } else {
        errorMessage = `OpenAI API error: ${error.message}`;
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * 批次翻譯（多個目標語言）
   * @param {string} text - 原文
   * @param {string} sourceLang - 來源語言
   * @param {string[]} targetLangs - 目標語言清單
   * @param {number} maxConcurrent - 最大併發數
   * @returns {Promise<Object>} - { [lang]: {text, model, at} }
   */
  async translateBatch(text, sourceLang, targetLangs, maxConcurrent = 2) {
    const results = {};
    const queue = [...targetLangs];

    // 併發控制
    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrent, targetLangs.length); i++) {
      workers.push(this.worker(queue, text, sourceLang, results));
    }

    await Promise.all(workers);
    return results;
  }

  /**
   * Worker 函數（處理佇列中的翻譯任務）
   */
  async worker(queue, text, sourceLang, results) {
    while (queue.length > 0) {
      const targetLang = queue.shift();
      if (!targetLang) break;

      try {
        const result = await this.translate(text, sourceLang, targetLang);
        if (result) {
          results[targetLang] = result;
        }
      } catch (error) {
        console.error(`[Translation] Failed to translate to ${targetLang}:`, error);
        results[targetLang] = {
          error: error.message,
          at: admin.firestore.Timestamp.now(),
        };
      }
    }
  }

  /**
   * 快取相關方法
   */
  getCacheKey(text, targetLang) {
    // 使用簡單的 hash（實際應用中可使用更好的 hash 函數）
    return `${text.substring(0, 50)}_${targetLang}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // 檢查是否過期
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 工具方法
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 檢查文字長度是否超過自動翻譯閾值
   */
  shouldAutoTranslate(text) {
    const maxLength = parseInt(process.env.MAX_AUTO_TRANSLATE_LENGTH || '500');
    return text.length <= maxLength;
  }
}

/**
 * 工廠函數：創建 TranslationService 實例
 *
 * 注意：不再使用單例模式，因為每次呼叫都需要傳入 API 金鑰
 *
 * @param {string} apiKey - OpenAI API 金鑰（從 Secret Manager 傳入）
 * @returns {TranslationService}
 */
function getTranslationService(apiKey) {
  return new TranslationService(apiKey);
}

module.exports = {
  TranslationService,
  getTranslationService,
};


