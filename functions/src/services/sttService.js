const OpenAI = require('openai');

/**
 * Speech-to-Text Service
 * 使用 OpenAI Whisper API 進行語音轉文字
 */
class SttService {
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

    // Whisper 模型配置
    this.model = process.env.WHISPER_MODEL || 'whisper-1';
    this.maxRetries = parseInt(process.env.MAX_RETRY_ATTEMPTS || '2');
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS || '1000');
  }

  /**
   * 語音轉文字
   * @param {Buffer} audioBuffer - 音訊檔案 Buffer
   * @param {string} language - 語言代碼（ISO 639-1，例如：zh, en, ja, ko, vi, th, ms, id）
   * @param {string} filename - 檔案名稱（需包含副檔名，例如：audio.m4a）
   * @returns {Promise<{text: string, language: string, duration: number}>}
   */
  async transcribe(audioBuffer, language, filename = 'audio.m4a') {
    const startTime = Date.now();

    // 驗證音訊檔案大小（Whisper API 限制為 25MB）
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioBuffer.length > maxSize) {
      throw new Error(`Audio file too large: ${audioBuffer.length} bytes (max: ${maxSize} bytes)`);
    }

    console.log(`[STT] Starting transcription: language=${language}, size=${audioBuffer.length} bytes, filename=${filename}`);

    // 執行轉錄（帶重試）
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.transcribeWithWhisper(audioBuffer, language, filename);
        
        const duration = Date.now() - startTime;
        console.log(`[STT] Transcription completed in ${duration}ms`);
        
        return {
          text: result.text,
          language: language,
          duration,
        };
      } catch (error) {
        lastError = error;
        console.error(`[STT] Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          // 指數退避
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.log(`[STT] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // 所有重試都失敗
    throw new Error(`Transcription failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * 使用 OpenAI Whisper API 進行語音轉文字
   * @param {Buffer} audioBuffer - 音訊檔案 Buffer
   * @param {string} language - 語言代碼
   * @param {string} filename - 檔案名稱
   * @returns {Promise<{text: string}>}
   */
  async transcribeWithWhisper(audioBuffer, language, filename) {
    try {
      // 將語言代碼轉換為 ISO 639-1 格式（Whisper API 要求）
      const whisperLanguage = this.convertToWhisperLanguage(language);

      // 使用 OpenAI SDK 的 toFile 函數將 Buffer 轉換為 File 對象
      // 注意：Node.js 環境中沒有 File 構造函數，必須使用 OpenAI.toFile()
      const file = await OpenAI.toFile(audioBuffer, filename, {
        type: this.getAudioMimeType(filename),
      });

      console.log(`[STT] Calling Whisper API: model=${this.model}, language=${whisperLanguage}, filename=${filename}`);

      // 調用 Whisper API
      const response = await this.openai.audio.transcriptions.create({
        file: file,
        model: this.model,
        language: whisperLanguage,
        response_format: 'json',
      });

      console.log(`[STT] Whisper API response: text="${response.text.substring(0, 100)}..."`);

      return {
        text: response.text.trim(),
      };
    } catch (error) {
      console.error('[STT] Whisper API error:', error);
      throw error;
    }
  }

  /**
   * 將應用語言代碼轉換為 Whisper API 支援的 ISO 639-1 格式
   * @param {string} appLanguage - 應用語言代碼（zh-TW, en, ja, ko, vi, th, ms, id）
   * @returns {string} - Whisper 語言代碼（zh, en, ja, ko, vi, th, ms, id）
   */
  convertToWhisperLanguage(appLanguage) {
    const languageMap = {
      'zh-TW': 'zh',
      'zh-CN': 'zh',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'vi': 'vi',
      'th': 'th',
      'ms': 'ms',
      'id': 'id',
    };

    return languageMap[appLanguage] || appLanguage.split('-')[0];
  }

  /**
   * 根據檔案名稱獲取 MIME 類型
   * @param {string} filename - 檔案名稱
   * @returns {string} - MIME 類型
   */
  getAudioMimeType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      'm4a': 'audio/m4a',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'mp4': 'audio/mp4',
      'mpeg': 'audio/mpeg',
      'mpga': 'audio/mpeg',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
    };

    return mimeTypes[extension] || 'audio/mpeg';
  }

  /**
   * 延遲函數
   * @param {number} ms - 延遲毫秒數
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SttService };

