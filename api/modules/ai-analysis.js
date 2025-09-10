// AI Analysis Module - OpenAI integration for food analysis

// Working OpenAI photo analysis
export async function analyzePhotoWithOpenAI(photos, caption, openaiKey, userContext) {
  try {
    console.log('Getting photo file...');
    
    // Get photo file
    const photo = photos[photos.length - 1];
    const fileResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok) {
      throw new Error('Failed to get photo file from Telegram');
    }

    console.log('Downloading photo...');
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    
    if (!photoResponse.ok) {
      throw new Error('Failed to download photo');
    }
    
    const photoBuffer = await photoResponse.arrayBuffer();
    const base64Image = Buffer.from(photoBuffer).toString('base64');

    console.log('Calling OpenAI Vision API...');

    // Use GPT-5 with Responses API for proper image analysis
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
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
              text: `Analyze this food photo and return detailed nutrition data with portion estimation.

${caption ? `User description: "${caption}"` : ''}

USER CONTEXT:
- Daily goals: ${userContext.goals.cal_goal} cal, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
- Today consumed: ${userContext.todayTotals.calories} cal, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber
- Meal #${userContext.mealsToday + 1} today
- Profile personalized: ${userContext.hasProfile ? 'Yes' : 'No'}

ANALYSIS REQUIREMENTS:
- Identify the main food items and estimate their individual portions
- Provide standardized food names (e.g. "Grilled Chicken Breast", "White Rice", "Mixed Vegetables")
- Estimate portion sizes in grams AND common measures (cups, pieces, palm-sized, etc.)
- Give visual portion descriptions for user understanding
- Consider plate/container size as reference for portions
- Account for cooking methods and added ingredients (oil, butter, sauces)
- Estimate total nutrition for the complete meal shown

Return JSON with nutrition data, standardized food name, portion estimates, and advice.`
            },
            { 
              type: "input_image", 
              image_url: `data:image/jpeg;base64,${base64Image}`
            }
          ]
        }],
        max_output_tokens: 400
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('GPT-5 Responses API response:', JSON.stringify(openaiData, null, 2));
    
    // For function calling, extract from function_call arguments
    const functionCall = openaiData.output?.find(o => o.type === "function_call");
    const functionArgs = functionCall?.arguments;
    
    console.log('Extracted function arguments:', functionArgs);
    
    if (!functionArgs) {
      // Fallback to output_text if no tool call
      const content = openaiData.output_text;
      if (content) {
        return parseNutritionResponse(content, 'photo');
      }
      
      console.error('No function_call or output_text in GPT-5 response:', Object.keys(openaiData));
      throw new Error(`No function call from GPT-5. Response keys: ${Object.keys(openaiData).join(', ')}`);
    }
    
    // Parse function arguments as JSON
    const parsed = JSON.parse(functionArgs);
    
    // Add meal score with user context
    parsed.score = calculateMealScore(parsed, userContext);
    
    console.log('Final parsed result:', parsed);
    return parsed;

  } catch (error) {
    console.error('Photo analysis error:', error);
    throw error; // Re-throw to be handled by caller
  }
}

// Working OpenAI text analysis
export async function analyzeTextWithOpenAI(text, openaiKey, userContext) {
  try {
    console.log('Calling OpenAI for text analysis...');

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: `Analyze this food description: "${text}"

USER CONTEXT:
- Daily nutrition goals: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
- Today's progress: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber consumed
- This is meal #${userContext.mealsToday + 1} today
- Remaining needs: ${userContext.goals.cal_goal - userContext.todayTotals.calories} calories, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein, ${userContext.goals.fiber_goal_g - userContext.todayTotals.fiber}g fiber
- Profile personalized: ${userContext.hasProfile ? 'Yes (goals are calculated for user)' : 'No (using defaults)'}

ANALYSIS REQUIREMENTS:
- Parse and standardize food names (e.g. "chicken" → "Grilled Chicken Breast")
- Interpret portion descriptions precisely (small/medium/large, cups, pieces, grams, ounces)
- Estimate actual portion sizes in grams AND common measures
- Consider preparation methods and cooking additions (oil, butter, sauces, seasonings)
- Provide visual portion descriptions (palm-sized, deck of cards, tennis ball, etc.)
- Assess protein quality and completeness for the estimated portion
- Identify all ingredients and estimate their individual contributions
- Calculate nutrition for the TOTAL described portion
- Give actionable advice based on remaining daily needs and portion accuracy

Return ONLY a JSON object with exact format:
{
  "calories": number,
  "protein_g": number (1 decimal place),
  "fat_g": number (1 decimal place),
  "carbs_g": number (1 decimal place),
  "fiber_g": number (1 decimal place),
  "confidence": number (0-1 based on description detail),
  "advice_short": "string (actionable advice max 120 chars)",
  "food_name": "string (standardized food name, e.g. 'Grilled Chicken Breast')",
  "portion_size": "string (estimated portion, e.g. '150g', '1 medium', '1 cup')",
  "portion_description": "string (visual description, e.g. 'palm-sized', 'small bowl', '2 slices')"
}`,
        reasoning: { effort: "high" },
        text: { verbosity: "low" }
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI text API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('GPT-5 text response:', openaiData.output_text?.substring(0, 200));
    
    const content = openaiData.output_text;
    
    if (!content) {
      throw new Error('No output_text from GPT-5 response');
    }

    return parseNutritionResponse(content, 'text');

  } catch (error) {
    console.error('Text analysis error:', error);
    throw error; // Re-throw to be handled by caller
  }
}

// Parse OpenAI response with better error handling
export function parseNutritionResponse(content, type) {
  try {
    console.log(`Parsing ${type} response:`, content);
    
    // Try to extract JSON from response
    let jsonString = content.trim();
    
    // Remove markdown formatting if present
    jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Find JSON object
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', content);
      throw new Error('No JSON object found in OpenAI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('Parsed JSON:', parsed);
    
    // Validate required fields
    if (typeof parsed.calories !== 'number' || 
        typeof parsed.protein_g !== 'number' || 
        typeof parsed.confidence !== 'number') {
      throw new Error('Invalid JSON structure from OpenAI');
    }

    // Clean and validate data
    const result = {
      calories: Math.max(50, Math.min(2000, Math.round(parsed.calories))),
      protein_g: Math.max(0, Math.min(100, Math.round((parsed.protein_g) * 10) / 10)),
      fat_g: Math.max(0, Math.min(100, Math.round((parsed.fat_g || 0) * 10) / 10)),
      carbs_g: Math.max(0, Math.min(200, Math.round((parsed.carbs_g || 0) * 10) / 10)),
      fiber_g: Math.max(0, Math.min(50, Math.round((parsed.fiber_g || 0) * 10) / 10)),
      confidence: Math.max(0.1, Math.min(1.0, parsed.confidence)),
      advice_short: (parsed.advice_short || 'Meal analyzed successfully.').substring(0, 120),
      food_name: (parsed.food_name || 'Unknown Food').substring(0, 100),
      portion_size: (parsed.portion_size || 'Unknown portion').substring(0, 50),
      portion_description: (parsed.portion_description || 'Standard serving').substring(0, 100)
    };

    // Calculate meal score with user context (not available in parseNutritionResponse)
    result.score = calculateBasicMealScore(result);

    console.log('Final result:', result);
    return result;

  } catch (error) {
    console.error('Parse response error:', error);
    console.error('Original content:', content);
    throw error; // Re-throw to be handled by caller
  }
}

// Get fallback analysis when AI fails
export function getFallbackAnalysis(message) {
  return {
    calories: 300,
    protein_g: 15,
    fat_g: 10,
    carbs_g: 30,
    fiber_g: 3,
    confidence: 0.2,
    advice_short: message,
    food_name: 'Mixed Food',
    portion_size: '~200g',
    portion_description: 'Medium serving',
    score: 5
  };
}

// Import scoring functions from utils
import { calculateMealScore, calculateBasicMealScore } from './utils.js';
