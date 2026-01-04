/**
 * 簡單測試 OpenAI API Key
 */

const OpenAI = require('openai');

// ⚠️ 安全性警告：請勿在代碼中硬編碼 API Key
// 使用環境變數或 Google Cloud Secret Manager
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ 錯誤：OPENAI_API_KEY 環境變數未設定');
  console.log('請設定環境變數：');
  console.log('  Windows: set OPENAI_API_KEY=your_key_here');
  console.log('  Linux/Mac: export OPENAI_API_KEY=your_key_here');
  console.log('');
  console.log('或使用 .env 檔案（需安裝 dotenv）');
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

console.log('Testing OpenAI API Key...');
console.log(`API Key: ${OPENAI_API_KEY.substring(0, 10)}...${OPENAI_API_KEY.substring(OPENAI_API_KEY.length - 4)}`);
console.log('');

async function testTranslation() {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a translator. Translate the following text to English.'
        },
        {
          role: 'user',
          content: '我愛你'
        }
      ],
      max_tokens: 100,
      temperature: 0.3
    });

    console.log('✅ API Key is VALID!');
    console.log('');
    console.log('Translation Result:');
    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.log('❌ API Key is INVALID!');
    console.log('');
    console.log('Error:');
    console.log(error.message);
    console.log('');
    console.log('Error Details:');
    console.log(error);
  }
}

testTranslation();

