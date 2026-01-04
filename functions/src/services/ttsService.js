const OpenAI = require('openai');

/**
 * TTS 服務
 * 使用 OpenAI TTS API 生成語音
 */
class TtsService {
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

    // 使用 tts-1-hd 高品質模型（更清晰、更自然）
    this.model = process.env.OPENAI_TTS_MODEL || 'tts-1-hd';
    this.maxRetries = parseInt(process.env.MAX_RETRY_ATTEMPTS || '2');
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS || '1000');
  }

  /**
   * 語音映射表（根據語言選擇合適的語音）
   */
  static VOICE_MAP = {
    'zh-TW': 'nova',    // 繁體中文 - 女聲，清晰
    'en': 'alloy',      // 英文 - 中性，通用
    'ja': 'shimmer',    // 日文 - 女聲，柔和
    'ko': 'nova',       // 韓文 - 女聲，清晰
    'vi': 'alloy',      // 越南文 - 中性，通用
    'th': 'nova',       // 泰文 - 女聲，清晰
    'ms': 'alloy',      // 馬來文 - 中性，通用
    'id': 'alloy',      // 印尼文 - 中性，通用
  };

  /**
   * 獲取語音類型
   * @param {string} language - 語言代碼
   * @returns {string} 語音類型
   */
  getVoice(language) {
    return TtsService.VOICE_MAP[language] || 'alloy';
  }

  /**
   * 生成語音
   * @param {string} text - 要轉換的文字
   * @param {string} language - 語言代碼
   * @returns {Promise<Buffer>} 音訊檔案（MP3 格式）
   */
  async generateSpeech(text, language) {
    const voice = this.getVoice(language);

    console.log(`[TTS] Generating speech: model=${this.model}, voice=${voice}, textLength=${text.length}`);

    // 執行 TTS（帶重試）
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.generateWithOpenAI(text, voice);
        console.log(`[TTS] Speech generated successfully in attempt ${attempt + 1}`);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[TTS] Attempt ${attempt + 1} failed:`, error.message);

        if (attempt < this.maxRetries) {
          // 指數退避
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.log(`[TTS] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // 所有重試都失敗
    throw new Error(`TTS generation failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * 使用 OpenAI API 生成語音
   * @param {string} text - 要轉換的文字
   * @param {string} voice - 語音類型
   * @returns {Promise<Buffer>} 音訊檔案（MP3 格式）
   */
  async generateWithOpenAI(text, voice) {
    const startTime = Date.now();

    try {
      const response = await this.openai.audio.speech.create({
        model: this.model,
        voice: voice,
        input: text,
        response_format: 'mp3',
      });

      const duration = Date.now() - startTime;

      // 將 response 轉換為 Buffer
      const buffer = Buffer.from(await response.arrayBuffer());

      console.log(`[TTS] Generated speech in ${duration}ms, size=${buffer.length} bytes`);

      return buffer;

    } catch (error) {
      console.error('[TTS] OpenAI API error:', error);
      throw error;
    }
  }

  /**
   * 延遲函數
   * @param {number} ms - 延遲毫秒數
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { TtsService };

