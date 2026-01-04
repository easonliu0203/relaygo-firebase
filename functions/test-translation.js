/**
 * 測試翻譯功能
 * 
 * 測試案例：
 * 1. 中文「新年快樂」→ 日文（應該是「あけましておめでとうございます」而非「新年おめでとうございます」）
 * 2. 中文「謝謝」→ 日文（應該是「ありがとうございます」而非「感謝します」）
 * 3. 英文「How are you?」→ 中文（應該是自然的問候語）
 */

const { TranslationService } = require('./src/services/translationService');

// ⚠️ 安全性警告：請勿在代碼中硬編碼 API Key
// 使用環境變數或 Google Cloud Secret Manager
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function testTranslation() {
  const apiKey = OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ 錯誤：OPENAI_API_KEY 環境變數未設定');
    console.log('請設定環境變數：');
    console.log('  Windows: set OPENAI_API_KEY=your_key_here');
    console.log('  Linux/Mac: export OPENAI_API_KEY=your_key_here');
    console.log('');
    console.log('或使用 .env 檔案（需安裝 dotenv）');
    return;
  }

  console.log('✅ API Key found:', apiKey.substring(0, 10) + '...');
  console.log('');

  const translationService = new TranslationService(apiKey);

  const testCases = [
    {
      text: '新年快樂',
      sourceLang: 'zh-TW',
      targetLang: 'ja',
      expected: 'あけましておめでとうございます',
      notExpected: '新年おめでとうございます',
    },
    {
      text: '謝謝',
      sourceLang: 'zh-TW',
      targetLang: 'ja',
      expected: 'ありがとうございます',
      notExpected: '感謝します',
    },
    {
      text: 'How are you?',
      sourceLang: 'en',
      targetLang: 'zh-TW',
      expected: '你好嗎',
      notExpected: '你怎麼樣',
    },
    {
      text: 'Good morning',
      sourceLang: 'en',
      targetLang: 'ja',
      expected: 'おはようございます',
      notExpected: '良い朝',
    },
  ];

  console.log('🧪 開始測試翻譯功能...\n');
  console.log('='.repeat(80));

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n測試案例 ${i + 1}/${testCases.length}`);
    console.log(`原文: "${testCase.text}" (${testCase.sourceLang})`);
    console.log(`目標語言: ${testCase.targetLang}`);
    console.log(`期望包含: "${testCase.expected}"`);
    console.log(`不應包含: "${testCase.notExpected}"`);
    console.log('-'.repeat(80));

    try {
      const result = await translationService.translate(
        testCase.text,
        testCase.sourceLang,
        testCase.targetLang
      );

      if (!result) {
        console.log('⚠️  翻譯被跳過（來源語言與目標語言相同）');
        continue;
      }

      const translatedText = result.text;
      console.log(`✅ 翻譯結果: "${translatedText}"`);
      console.log(`   模型: ${result.model}`);
      console.log(`   Token 使用: ${result.tokensUsed}`);
      console.log(`   耗時: ${result.duration}ms`);

      // 檢查結果
      const containsExpected = translatedText.includes(testCase.expected);
      const containsNotExpected = translatedText.includes(testCase.notExpected);

      if (containsExpected) {
        console.log(`✅ 通過：包含期望的自然表達 "${testCase.expected}"`);
      } else {
        console.log(`⚠️  警告：未包含期望的表達 "${testCase.expected}"`);
      }

      if (containsNotExpected) {
        console.log(`❌ 失敗：包含不自然的直譯 "${testCase.notExpected}"`);
      } else {
        console.log(`✅ 通過：未包含直譯表達 "${testCase.notExpected}"`);
      }

    } catch (error) {
      console.error(`❌ 錯誤: ${error.message}`);
    }

    console.log('='.repeat(80));
  }

  console.log('\n✅ 測試完成！');
}

// 執行測試
testTranslation().catch(console.error);

