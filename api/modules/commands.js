// Commands Module - All bot commands handlers

import { sendMessage, sendMessageWithKeyboard } from './telegram-helpers.js';
import { getUserContext, ensureUserExists } from './database.js';

export async function handleHelpCommand(chatId, botToken) {
  const helpText = `<b>Soma - Your Nutrition Assistant</b>

<b>Food Analysis:</b>
Send photos or describe your meals to get detailed nutrition breakdowns with portion estimates.

<b>Meal Management:</b>
View and manage your recent meals with simple delete functionality.

<b>Commands:</b>
/start - get started or return home
/meals - view recent meals
/today - daily nutrition summary
/goals - view your targets  
/profile - manage your profile
/reset - reset all data
/help - this reference

<b>Examples:</b>
"Scrambled eggs with toast"
"Caesar salad, large portion" 
"Protein shake with banana"

Just send a photo or description to get started.`;

  await sendMessage(chatId, helpText, botToken);
}

export async function handleTestCommand(chatId, botToken, openaiKey, supabaseUrl) {
  // Test OpenAI connection
  let openaiStatus = '❌ Not configured';
  if (openaiKey) {
    try {
      const testResponse = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${openaiKey}` }
      });
      if (testResponse.ok) {
        const models = await testResponse.json();
        const hasGPT4o = models.data.some(m => m.id === 'gpt-4o');
        openaiStatus = hasGPT4o ? '✅ GPT-4o Available' : '⚠️ Limited models';
      } else {
        openaiStatus = '❌ API Error';
      }
    } catch {
      openaiStatus = '❌ Connection failed';
    }
  }

  // Test Supabase
  let supabaseStatus = '❌ Not configured';
  if (supabaseUrl) {
    try {
      const testResponse = await fetch(`${supabaseUrl}/rest/v1/users?select=count`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      supabaseStatus = testResponse.ok ? '✅ Connected' : '❌ Connection error';
    } catch {
      supabaseStatus = '❌ Unavailable';
    }
  }

  const testText = `🧪 <b>Soma Systems Test</b>

🕐 <b>Time:</b> ${new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })}
🌐 <b>Server:</b> Vercel (USA)
🔧 <b>Runtime:</b> Node.js ${process.version}

🔐 <b>System Status:</b>
✅ Telegram Bot API: Working
${openaiStatus}
${supabaseStatus}
✅ Timezone: Europe/Madrid

📡 <b>Webhook:</b> Active and responding
🚀 <b>Ready:</b> Send food photos for AI analysis!`;

  await sendMessage(chatId, testText, botToken);
}

// Add other command handlers here...
