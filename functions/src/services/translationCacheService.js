const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

/**
 * 翻譯快取服務
 * 使用 Firestore 作為快取層，減少 OpenAI API 調用次數
 */
class TranslationCacheService {
  constructor() {
    this.db = getFirestore();
    this.cacheCollection = 'translation_cache';
    this.cacheExpirationDays = 30; // 快取過期時間：30 天
  }

  /**
   * 生成快取鍵（SHA256 hash）
   * @param {string} text - 原文
   * @param {string} targetLang - 目標語言
   * @returns {string} - SHA256 hash
   */
  generateCacheKey(text, targetLang) {
    const input = `${text}|${targetLang}`;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * 從快取中獲取翻譯
   * @param {string} text - 原文
   * @param {string} targetLang - 目標語言
   * @returns {Promise<string|null>} - 翻譯結果或 null
   */
  async getTranslation(text, targetLang) {
    try {
      const cacheKey = this.generateCacheKey(text, targetLang);
      const cacheDoc = await this.db
        .collection(this.cacheCollection)
        .doc(cacheKey)
        .get();

      if (!cacheDoc.exists) {
        return null;
      }

      const cacheData = cacheDoc.data();
      const now = new Date();
      const expirationDate = new Date(
        cacheData.createdAt.toDate().getTime() +
        this.cacheExpirationDays * 24 * 60 * 60 * 1000
      );

      // 檢查是否過期
      if (now > expirationDate) {
        // 過期，刪除快取
        await this.db.collection(this.cacheCollection).doc(cacheKey).delete();
        return null;
      }

      // 更新最後訪問時間
      await this.db.collection(this.cacheCollection).doc(cacheKey).update({
        lastAccessedAt: FieldValue.serverTimestamp(),
        accessCount: FieldValue.increment(1),
      });

      return cacheData.translatedText;
    } catch (error) {
      console.error('Error getting translation from cache:', error);
      return null;
    }
  }

  /**
   * 將翻譯結果寫入快取
   * @param {string} text - 原文
   * @param {string} targetLang - 目標語言
   * @param {string} translatedText - 翻譯結果
   * @returns {Promise<void>}
   */
  async setTranslation(text, targetLang, translatedText) {
    try {
      const cacheKey = this.generateCacheKey(text, targetLang);
      await this.db.collection(this.cacheCollection).doc(cacheKey).set({
        text,
        targetLang,
        translatedText,
        createdAt: FieldValue.serverTimestamp(),
        lastAccessedAt: FieldValue.serverTimestamp(),
        accessCount: 1,
      });
    } catch (error) {
      console.error('Error setting translation in cache:', error);
      // 不拋出錯誤，快取失敗不應影響翻譯功能
    }
  }

  /**
   * 清理過期的快取
   * @returns {Promise<number>} - 刪除的文檔數量
   */
  async cleanupExpiredCache() {
    try {
      const expirationDate = new Date(
        Date.now() - this.cacheExpirationDays * 24 * 60 * 60 * 1000
      );

      const expiredDocs = await this.db
        .collection(this.cacheCollection)
        .where('createdAt', '<', expirationDate)
        .get();

      const batch = this.db.batch();
      expiredDocs.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return expiredDocs.size;
    } catch (error) {
      console.error('Error cleaning up expired cache:', error);
      return 0;
    }
  }
}

module.exports = TranslationCacheService;

