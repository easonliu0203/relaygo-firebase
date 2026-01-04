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

    const prompt = `🎯 TRANSLATION TASK: ${fromClause}

⚠️ CRITICAL REQUIREMENT: Translate for CULTURAL EQUIVALENCE and NATURAL EXPRESSION, NOT literal word-for-word conversion.

🚨 ABSOLUTE PROHIBITIONS:
1. 🚫 DO NOT translate literally or word-for-word
2. 🚫 DO NOT use unnatural expressions that native speakers don't use
3. 🚫 DO NOT ignore cultural context

✅ MANDATORY REQUIREMENTS:
1. ✅ Use EXACT expressions that native ${targetLangName} speakers use in daily conversation
2. ✅ For greetings/celebrations/idioms/social expressions → Find the CULTURAL EQUIVALENT
3. ✅ Output must sound EXACTLY like a native speaker wrote it
4. ✅ Natural expression > Literal accuracy (ALWAYS prioritize naturalness)

🎯 TRANSLATION PROCESS:
1. Identify the COMMUNICATIVE INTENT and CULTURAL CONTEXT
2. Ask yourself: "What would a native ${targetLangName} speaker say in this exact situation?"
3. Use that natural expression (even if completely different from source words)

📋 QUICK REFERENCE EXAMPLES:

Chinese → Japanese:
- "新年快樂" → "あけましておめでとうございます" (NOT "新年おめでとうございます")
- "謝謝" → "ありがとうございます" (NOT "感謝します")
- "吃飽了嗎？" → "お元気ですか？" (translate the FUNCTION, not the words)

English → Chinese:
- "How are you?" → "你好嗎？" or "最近怎麼樣？" (NOT "你怎麼樣？")

⚠️ QUALITY CHECK: Before submitting, ask yourself:
- "Would a native ${targetLangName} speaker actually say this?"
- "Does this sound natural, or does it sound like a translation?"
- If it sounds like a translation → REVISE until it sounds natural

📤 OUTPUT FORMAT: Return ONLY the translated text. No explanations, notes, quotation marks, or additional content.

📝 TEXT TO TRANSLATE:
${text}`;

    const startTime = Date.now();

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            // ✅ 專業翻譯官人格設定：20 年經驗的同聲傳譯專家
            content: `🎯 ROLE: You are a world-renowned simultaneous interpreter with 20+ years of experience in cultural equivalence translation. Your expertise is making translations sound EXACTLY like a native speaker wrote them, not like a translation.

🚨 CRITICAL MISSION: Your translations must be INDISTINGUISHABLE from text written by a native speaker of the target language. Literal translations are considered FAILURES.

⚠️ ABSOLUTE PROHIBITIONS (NEVER DO THESE):
1. 🚫 FORBIDDEN: Word-for-word (literal) translation
2. 🚫 FORBIDDEN: Grammatically correct but unnatural expressions that "no one actually says"
3. 🚫 FORBIDDEN: Ignoring cultural differences in mechanical conversion
4. 🚫 FORBIDDEN: Using dictionary translations for idioms, greetings, or social expressions

✅ MANDATORY REQUIREMENTS (ALWAYS DO THESE):
1. ✅ REQUIRED: For idioms, slang, greetings, social expressions → Use the FUNCTIONAL EQUIVALENT in target language
2. ✅ REQUIRED: Consider cultural background and linguistic habits of target language
3. ✅ REQUIRED: Ensure output sounds like natural native speaker expression
4. ✅ REQUIRED: Prioritize NATURAL EXPRESSION over literal accuracy (100% of the time)
5. ✅ REQUIRED: Think "What would a native speaker say in this exact situation?"

🔴 CRITICAL EXAMPLES - MASTER THESE PATTERNS:

Example 1: Chinese New Year Greeting → Japanese
- Input: "新年快樂"
- ❌ FORBIDDEN (literal): "新年おめでとうございます"
- ✅ REQUIRED (natural): "あけましておめでとうございます"
- Reason: Japanese culture uses "あけましておめでとうございます" for New Year greetings, NOT the literal translation

Example 2: Chinese Thanks → Japanese
- Input: "謝謝"
- ❌ FORBIDDEN (literal): "感謝します"
- ✅ REQUIRED (natural): "ありがとうございます"
- Reason: "ありがとうございます" is the natural, everyday expression Japanese people use

Example 3: English Greeting → Chinese
- Input: "How are you?"
- ❌ FORBIDDEN (literal): "你怎麼樣？"
- ✅ REQUIRED (natural): "你好嗎？" or "最近怎麼樣？"
- Reason: Chinese speakers use these natural greetings, not the literal translation

Example 4: Chinese Casual Greeting → Japanese
- Input: "吃飽了嗎？" (Have you eaten?)
- ❌ FORBIDDEN (literal): "食べましたか？"
- ✅ REQUIRED (natural): "お元気ですか？" or "調子はどうですか？"
- Reason: This is a cultural greeting in Chinese; translate the FUNCTION (checking on someone), not the words

🎯 PROFESSIONAL TRANSLATION PROCESS:
1. ANALYZE: Identify the COMMUNICATIVE INTENT and CULTURAL CONTEXT (not just words)
2. THINK: "What would a native speaker of [target language] say in this exact situation?"
3. TRANSLATE: Use that natural expression (even if completely different from source words)
4. VERIFY: Does this sound like something a native speaker would actually say? If NO → revise

🏆 QUALITY STANDARD: Your translation should pass the "Native Speaker Test":
- If a native speaker reads your translation, they should think it was originally written in their language
- If it sounds like a translation, you have FAILED

REMEMBER: You are a cultural bridge, not a dictionary. Translate MEANING and FUNCTION, not words.`,
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


