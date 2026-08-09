import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  console.error('OPENAI_API_KEY not set. Please configure it in your environment.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

async function testOpenAI() {
  try {
    console.log('Testing OpenAI API key...');
    
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "user", content: "Hello, this is a test message." }
      ],
      max_tokens: 50
    });

    console.log('✅ API key is working!');
    console.log('Response:', completion.choices[0].message.content);
  } catch (error) {
    console.log('❌ API key test failed:');
    console.log('Error:', error.message);
    console.log('Status:', error.status);
    console.log('Code:', error.code);
  }
}

testOpenAI();