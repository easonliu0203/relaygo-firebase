/**
 * 清除翻譯快取腳本
 * 
 * 用途：清除 Firestore 中的舊翻譯快取，以便使用新的母語化 prompt 重新翻譯
 * 
 * 使用方式：
 * 1. 確保已安裝 firebase-admin: npm install firebase-admin
 * 2. 執行腳本: node clear-translation-cache.js
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

// 初始化 Firebase Admin
admin.initializeApp({
  projectId: 'ride-platform-f1676',
});

const db = admin.firestore();

/**
 * 生成快取鍵
 */
function generateCacheKey(text, targetLang) {
  const input = `${text}|${targetLang}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * 方案 1：清除所有翻譯快取
 */
async function clearAllCache() {
  console.log('🗑️  開始清除所有翻譯快取...\n');
  
  try {
    const snapshot = await db.collection('translation_cache').get();
    
    if (snapshot.empty) {
      console.log('✅ 快取集合為空，無需清除');
      return;
    }
    
    console.log(`📊 找到 ${snapshot.size} 個快取項目`);
    
    // 使用批次操作刪除
    const batchSize = 500; // Firestore 批次操作限制
    let deletedCount = 0;
    
    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = snapshot.docs.slice(i, i + batchSize);
      
      batchDocs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      deletedCount += batchDocs.length;
      
      console.log(`   已刪除 ${deletedCount}/${snapshot.size} 個快取項目...`);
    }
    
    console.log(`\n✅ 成功清除 ${deletedCount} 個翻譯快取`);
    console.log('💡 提示：下次翻譯時會使用新的母語化 prompt');
    
  } catch (error) {
    console.error('❌ 清除快取失敗:', error);
    throw error;
  }
}

/**
 * 方案 2：清除特定文字的翻譯快取
 */
async function clearSpecificCache(translations) {
  console.log('🗑️  開始清除特定翻譯快取...\n');
  
  let deletedCount = 0;
  let notFoundCount = 0;
  
  for (const { text, targetLang } of translations) {
    try {
      const cacheKey = generateCacheKey(text, targetLang);
      const docRef = db.collection('translation_cache').doc(cacheKey);
      const doc = await docRef.get();
      
      if (doc.exists) {
        await docRef.delete();
        deletedCount++;
        console.log(`✅ 已刪除: "${text}" -> ${targetLang}`);
      } else {
        notFoundCount++;
        console.log(`⚠️  未找到: "${text}" -> ${targetLang}`);
      }
    } catch (error) {
      console.error(`❌ 刪除失敗: "${text}" -> ${targetLang}`, error);
    }
  }
  
  console.log(`\n📊 清除結果:`);
  console.log(`   ✅ 成功刪除: ${deletedCount} 個`);
  console.log(`   ⚠️  未找到: ${notFoundCount} 個`);
}

/**
 * 方案 3：查看快取內容（診斷用）
 */
async function inspectCache(text, targetLang) {
  console.log(`🔍 檢查快取: "${text}" -> ${targetLang}\n`);
  
  try {
    const cacheKey = generateCacheKey(text, targetLang);
    const doc = await db.collection('translation_cache').doc(cacheKey).get();
    
    if (!doc.exists) {
      console.log('❌ 快取不存在');
      return;
    }
    
    const data = doc.data();
    console.log('✅ 快取存在:');
    console.log(`   原文: ${data.text}`);
    console.log(`   譯文: ${data.translatedText}`);
    console.log(`   目標語言: ${data.targetLang}`);
    console.log(`   創建時間: ${data.createdAt?.toDate()}`);
    console.log(`   訪問次數: ${data.accessCount}`);
    console.log(`   最後訪問: ${data.lastAccessedAt?.toDate()}`);
    
  } catch (error) {
    console.error('❌ 檢查快取失敗:', error);
  }
}

/**
 * 主函數
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';
  
  console.log('=' .repeat(80));
  console.log('🧹 翻譯快取清除工具');
  console.log('=' .repeat(80));
  console.log('');
  
  try {
    if (command === 'all') {
      // 清除所有快取
      await clearAllCache();
      
    } else if (command === 'specific') {
      // 清除特定快取（測試案例）
      const testCases = [
        { text: '新年快樂', targetLang: 'ja' },
        { text: '謝謝', targetLang: 'ja' },
        { text: '吃飽了嗎？', targetLang: 'ja' },
        { text: 'How are you?', targetLang: 'zh-TW' },
      ];
      
      await clearSpecificCache(testCases);
      
    } else if (command === 'inspect') {
      // 檢查特定快取
      const text = args[1] || '新年快樂';
      const targetLang = args[2] || 'ja';
      await inspectCache(text, targetLang);
      
    } else {
      console.log('❌ 未知命令');
      console.log('\n使用方式:');
      console.log('  node clear-translation-cache.js all              # 清除所有快取');
      console.log('  node clear-translation-cache.js specific         # 清除測試案例快取');
      console.log('  node clear-translation-cache.js inspect "文字" ja  # 檢查特定快取');
    }
    
  } catch (error) {
    console.error('\n❌ 執行失敗:', error);
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

// 執行主函數
main();

