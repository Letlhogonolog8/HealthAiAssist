// Test the new OpenAI API key
import OpenAI from 'openai';

const apiKey = '***REMOVED-OPENAI-KEY***';

console.log('🔑 Testing new OpenAI API key...');
console.log('📝 Key starts with:', apiKey.substring(0, 20) + '...');

const openai = new OpenAI({ apiKey });

async function testChatbot() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are MedAI Assistant, a medical AI chatbot for cancer detection platform."
        },
        {
          role: "user",
          content: "Hello, can you help me understand cancer screening?"
        }
      ],
      max_tokens: 200,
      temperature: 0.7
    });

    console.log('✅ API Key is working!');
    console.log('🤖 Chatbot Response:');
    console.log(completion.choices[0].message.content);
    
  } catch (error) {
    console.error('❌ API Key test failed:', error.message);
    
    if (error.status === 401) {
      console.log('🔐 Invalid API key');
    } else if (error.status === 429) {
      console.log('⏰ Rate limit exceeded');
    } else {
      console.log('🌐 Network or API error');
    }
  }
}

testChatbot();