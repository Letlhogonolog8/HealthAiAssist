// Simple test script to verify OpenAI API key
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('❌ OPENAI_API_KEY not found in environment variables');
  console.log('Please set your OpenAI API key in system environment variables:');
  console.log('1. Open System Properties > Environment Variables');
  console.log('2. Add new system variable: OPENAI_API_KEY = your_api_key_here');
  process.exit(1);
}

console.log('✅ OPENAI_API_KEY found in environment');
console.log('🔑 API Key starts with:', apiKey.substring(0, 7) + '...');

const openai = new OpenAI({ apiKey });

async function testConnection() {
  try {
    console.log('🧪 Testing OpenAI connection...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello, this is a test message." }],
      max_tokens: 50
    });

    console.log('✅ OpenAI API connection successful!');
    console.log('📝 Test response:', completion.choices[0].message.content);
    
  } catch (error) {
    console.error('❌ OpenAI API test failed:', error.message);
    
    if (error.status === 401) {
      console.log('🔐 Invalid API key. Please check your OPENAI_API_KEY.');
    } else if (error.status === 429) {
      console.log('⏰ Rate limit exceeded. Please try again later.');
    } else {
      console.log('🌐 Network or API error. Please check your connection.');
    }
  }
}

testConnection();