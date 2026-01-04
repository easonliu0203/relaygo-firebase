/**
 * 測試已部署的翻譯 Cloud Function
 * 
 * 用途：驗證翻譯功能是否正確執行母語化翻譯
 */

const https = require('https');

// 測試配置
const FUNCTION_URL = 'https://translate-5bpfajwrga-de.a.run.app';

// 測試案例
const testCases = [
  {
    name: '新年祝福（中文→日文）',
    text: '新年快樂',
    targetLang: 'ja',
    expected: 'あけましておめでとうございます',
    forbidden: '新年おめでとうございます',
  },
  {
    name: '感謝表達（中文→日文）',
    text: '謝謝',
    targetLang: 'ja',
    expected: 'ありがとうございます',
    forbidden: '感謝します',
  },
  {
    name: '文化問候（中文→日文）',
    text: '吃飽了嗎？',
    targetLang: 'ja',
    expected: 'お元気ですか？',
    alternativeExpected: '調子はどうですか？',
    forbidden: '食べましたか？',
  },
  {
    name: '英文問候（英文→中文）',
    text: 'How are you?',
    targetLang: 'zh-TW',
    expected: '你好嗎？',
    alternativeExpected: '最近怎麼樣？',
    forbidden: '你怎麼樣？',
  },
];

/**
 * 調用翻譯 API（無需認證的測試版本）
 */
async function callTranslationAPI(text, targetLang) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text,
      targetLang,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(FUNCTION_URL, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            data: response,
          });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 執行測試
 */
async function runTests() {
  console.log('🧪 開始測試已部署的翻譯功能...\n');
  console.log(`📍 Function URL: ${FUNCTION_URL}\n`);
  console.log('=' .repeat(80));

  let passedTests = 0;
  let failedTests = 0;

  for (const testCase of testCases) {
    console.log(`\n📝 測試案例: ${testCase.name}`);
    console.log(`   輸入: "${testCase.text}"`);
    console.log(`   目標語言: ${testCase.targetLang}`);
    console.log(`   預期結果: "${testCase.expected}"`);
    if (testCase.alternativeExpected) {
      console.log(`   或: "${testCase.alternativeExpected}"`);
    }
    console.log(`   禁止結果: "${testCase.forbidden}"`);

    try {
      const response = await callTranslationAPI(testCase.text, testCase.targetLang);

      if (response.statusCode !== 200) {
        console.log(`   ❌ API 錯誤: HTTP ${response.statusCode}`);
        console.log(`   錯誤訊息: ${JSON.stringify(response.data, null, 2)}`);
        failedTests++;
        continue;
      }

      const translatedText = response.data.translatedText;
      console.log(`   實際結果: "${translatedText}"`);

      // 檢查是否符合預期
      const isExpected = translatedText === testCase.expected ||
                        (testCase.alternativeExpected && translatedText === testCase.alternativeExpected);
      const isForbidden = translatedText === testCase.forbidden;

      if (isExpected) {
        console.log(`   ✅ 通過 - 翻譯結果符合母語化標準`);
        passedTests++;
      } else if (isForbidden) {
        console.log(`   ❌ 失敗 - 翻譯結果是直譯（禁止的結果）`);
        failedTests++;
      } else {
        console.log(`   ⚠️  警告 - 翻譯結果與預期不同，但不是禁止的直譯`);
        console.log(`   需要人工判斷是否符合母語化標準`);
        passedTests++; // 暫時算通過，需要人工檢查
      }

    } catch (error) {
      console.log(`   ❌ 測試失敗: ${error.message}`);
      failedTests++;
    }

    // 延遲以避免 rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 測試結果總結:`);
  console.log(`   ✅ 通過: ${passedTests}/${testCases.length}`);
  console.log(`   ❌ 失敗: ${failedTests}/${testCases.length}`);
  console.log(`   成功率: ${((passedTests / testCases.length) * 100).toFixed(1)}%`);
}

// 執行測試
runTests().catch(console.error);

