import OpenAI from 'openai';

const apiKey = '***REMOVED-OPENAI-KEY***';

const openai = new OpenAI({ apiKey });

async function testOpenAI() {
  try {
    console.log('Testing OpenAI API key...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
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