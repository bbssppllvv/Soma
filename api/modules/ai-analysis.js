// AI Analysis Module - Universal GPT-5 pipeline for all food analysis

// Universal GPT-5 analysis - handles both photo and text
export async function analyzeWithGPT5(message, openaiKey, userContext) {
  const text = message.text || message.caption || '';
  const hasPhoto = message.photo && message.photo.length > 0;
  
  try {
    // console.log('Starting GPT-5 analysis...');
    
    // Add timeout protection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let requestBody;

    if (hasPhoto) {
      // Photo analysis
      const base64Image = await getPhotoAsBase64(message.photo, openaiKey);
      requestBody = createPhotoAnalysisRequest(base64Image, text, userContext);
    } else {
      // Text analysis  
      requestBody = createTextAnalysisRequest(text, userContext);
    }

    try {
      const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
      });

      clearTimeout(timeoutId);

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        console.error('OpenAI API error:', openaiResponse.status, errorText);
        throw new Error(`OpenAI API error: ${openaiResponse.status}`);
      }

      const openaiData = await openaiResponse.json();
      // console.log('GPT-5 response received');
      
      return parseGPT5Response(openaiData, userContext);

    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('GPT-5 analysis timeout after 25 seconds');
        throw new Error('Analysis timeout');
      }
      throw fetchError;
    }

  } catch (error) {
    console.error('GPT-5 analysis error:', error);
    throw error;
  }
}

// Get photo as base64
async function getPhotoAsBase64(photos, openaiKey) {
  const photo = photos[photos.length - 1];
  const fileResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
  const fileData = await fileResponse.json();
  
  if (!fileData.ok) {
    throw new Error('Failed to get photo file from Telegram');
  }

  const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
  const photoResponse = await fetch(photoUrl);
  
  if (!photoResponse.ok) {
    throw new Error('Failed to download photo');
  }
  
  const photoBuffer = await photoResponse.arrayBuffer();
  return Buffer.from(photoBuffer).toString('base64');
}

// Create photo analysis request
function createPhotoAnalysisRequest(base64Image, caption, userContext) {
  return {
    model: 'gpt-5-mini',
    reasoning: { effort: "minimal" },
    text: { verbosity: "low" },
    tools: [{
      type: "function",
      name: "food_analysis",
      description: "Return nutrition estimation for the photo",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          calories: { type: "integer" },
          protein_g: { type: "number" },
          fat_g: { type: "number" },
          carbs_g: { type: "number" },
          fiber_g: { type: "number" },
          confidence: { type: "number" },
          advice_short: { type: "string" },
          food_name: { type: "string" },
          portion_size: { type: "string" },
          portion_description: { type: "string" }
        },
        required: ["calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "confidence", "advice_short", "food_name", "portion_size", "portion_description"]
      }
    }],
    tool_choice: { type: "function", name: "food_analysis" },
    input: [{
      role: "user",
      content: [
        { 
          type: "input_text", 
          text: `Analyze this food photo AND the user's description together.

${caption ? `User description: "${caption}"` : 'No description provided - analyze what you see in the photo.'}

User needs ${userContext.goals.cal_goal - userContext.todayTotals.calories} cal, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein today.

IMPORTANT: Analyze the COMPLETE MEAL shown in the photo. If user description mentions only part of it (like "two eggs"), still analyze EVERYTHING visible in the photo.

Return JSON:
{
  "calories": number,
  "protein_g": number,
  "fat_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "confidence": number,
  "advice_short": "string",
  "food_name": "string",
  "portion_size": "string",
  "portion_description": "string"
}`
        },
        { 
          type: "input_image", 
          image_url: `data:image/jpeg;base64,${base64Image}`
        }
      ]
    }],
    max_output_tokens: 400
  };
}

// Create text analysis request - simplified for reliability
function createTextAnalysisRequest(text, userContext) {
  return {
    model: 'gpt-5-mini',
    input: `Analyze food: "${text}"

User needs ${userContext.goals.cal_goal - userContext.todayTotals.calories} cal, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein today.

Return ONLY JSON (no markdown):
{"calories": number, "protein_g": number, "fat_g": number, "carbs_g": number, "fiber_g": number, "confidence": number, "advice_short": "string", "food_name": "string", "portion_size": "string", "portion_description": "string"}`,
    reasoning: { effort: "minimal" },
    text: { verbosity: "low" }
  };
}

// Universal analysis prompt
function createAnalysisPrompt(text, userContext) {
  return `Analyze this food: "${text}"

User needs ${userContext.goals.cal_goal - userContext.todayTotals.calories} cal, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein today.

Return JSON:
{
  "calories": number,
  "protein_g": number,
  "fat_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "confidence": number,
  "advice_short": "string",
  "food_name": "string",
  "portion_size": "string", 
  "portion_description": "string"
}`;
}

// Parse GPT-5 response (universal)
function parseGPT5Response(openaiData, userContext) {
  console.log('GPT-5 raw response:', JSON.stringify(openaiData, null, 2));
  
  // Handle function call response (photo)
  const functionCall = openaiData.output?.find(o => o.type === "function_call");
  if (functionCall?.arguments) {
    const parsed = JSON.parse(functionCall.arguments);
    parsed.score = calculateMealScore(parsed, userContext);
    return cleanNutritionData(parsed);
  }
  
  // Handle text response
  if (openaiData.output_text) {
    return parseTextResponse(openaiData.output_text, userContext);
  }
  
  // Log what we actually got to debug
  console.error('GPT-5 response structure:', Object.keys(openaiData));
  console.error('Output array:', openaiData.output);
  console.error('Output text:', openaiData.output_text);
  
  throw new Error(`GPT-5 returned unexpected format. Keys: ${Object.keys(openaiData).join(', ')}`);
}

// Parse text response
function parseTextResponse(content, userContext) {
  // Extract JSON from text response
  let jsonString = content.trim();
  jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  parsed.score = calculateMealScore(parsed, userContext);
  return cleanNutritionData(parsed);
}

// Clean and validate nutrition data
function cleanNutritionData(parsed) {
  return {
    calories: Math.max(1, Math.min(2000, Math.round(parsed.calories))),
    protein_g: Math.max(0, Math.min(100, Math.round((parsed.protein_g) * 10) / 10)),
    fat_g: Math.max(0, Math.min(100, Math.round((parsed.fat_g || 0) * 10) / 10)),
    carbs_g: Math.max(0, Math.min(200, Math.round((parsed.carbs_g || 0) * 10) / 10)),
    fiber_g: Math.max(0, Math.min(50, Math.round((parsed.fiber_g || 0) * 10) / 10)),
    confidence: Math.max(0.1, Math.min(1.0, parsed.confidence)),
    advice_short: (parsed.advice_short || 'Analyzed successfully.').substring(0, 120),
    food_name: (parsed.food_name || 'Unknown Food').substring(0, 100),
    portion_size: (parsed.portion_size || 'Standard').substring(0, 50),
    portion_description: (parsed.portion_description || 'Medium serving').substring(0, 100),
    score: parsed.score || 6.0
  };
}

// Simple fallback when GPT-5 fails
export function getFallbackAnalysis(message) {
  return {
    calories: 300,
    protein_g: 15,
    fat_g: 10,
    carbs_g: 30,
    fiber_g: 3,
    confidence: 0.3,
    advice_short: message,
    food_name: 'Mixed Food',
    portion_size: 'Standard',
    portion_description: 'Medium serving',
    score: 6.0
  };
}

// Import scoring from utils
import { calculateMealScore } from './utils.js';

// Legacy functions removed - using universal analyzeWithGPT5 only
