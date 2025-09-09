import OpenAI from 'openai';
import { NutritionAnalysis, User, DailyEntry } from '../types';

export class LLMService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeFoodFromPhoto(
    photoBuffer: Buffer,
    caption?: string,
    user?: User,
    recentDays?: DailyEntry[]
  ): Promise<NutritionAnalysis> {
    try {
      const base64Image = photoBuffer.toString('base64');
      const mimeType = this.detectImageMimeType(photoBuffer);

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(caption, user, recentDays);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // Using GPT-4o Vision for photo analysis
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'low', // Use low detail for faster processing and lower costs
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.3, // Lower temperature for more consistent results
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseNutritionResponse(content);
    } catch (error) {
      console.error('Error analyzing food from photo:', error);
      return this.getDefaultAnalysis('Ошибка анализа фото. Попробуйте ещё раз или опишите текстом.');
    }
  }

  async analyzeFoodFromText(
    text: string,
    user?: User,
    recentDays?: DailyEntry[]
  ): Promise<NutritionAnalysis> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(text, user, recentDays);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Using cheaper model for text-only analysis
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: 400,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseNutritionResponse(content);
    } catch (error) {
      console.error('Error analyzing food from text:', error);
      return this.getDefaultAnalysis('Ошибка анализа текста. Проверьте описание блюда.');
    }
  }

  private buildSystemPrompt(): string {
    return `You are Soma, a nutrition assistant. Analyze food and provide nutritional estimates in JSON format.

Rules:
- Be conservative with calorie estimates
- Consider typical portion sizes
- If unsure about portions, assume moderate serving
- Provide confidence score based on how clear the food identification is
- Give supportive, non-judgmental advice
- Focus on balance and adding nutrients rather than restricting
- Keep advice under 120 characters
- Respond ONLY with valid JSON, no additional text

JSON format:
{
  "calories": number,
  "protein_g": number,
  "fat_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "confidence": number (0-1),
  "advice_short": "string (max 120 chars in Russian)"
}`;
  }

  private buildUserPrompt(
    input: string | undefined,
    user?: User,
    recentDays?: DailyEntry[]
  ): string {
    let prompt = '';

    if (input) {
      prompt += `Food description: "${input}"\n`;
    }

    if (user) {
      prompt += `User goals: calories=${user.cal_goal}, protein=${user.protein_goal_g}g, fiber=${user.fiber_goal_g}g\n`;
    }

    if (recentDays && recentDays.length > 0) {
      const avgCalories = recentDays.reduce((sum, day) => sum + day.calories_sum, 0) / recentDays.length;
      const avgProtein = recentDays.reduce((sum, day) => sum + day.protein_sum, 0) / recentDays.length;
      const avgFiber = recentDays.reduce((sum, day) => sum + day.fiber_sum, 0) / recentDays.length;

      prompt += `Recent 3 days average: calories ${Math.round(avgCalories)}, protein ${Math.round(avgProtein)}g, fiber ${Math.round(avgFiber)}g\n`;
    }

    prompt += '\nAnalyze and return JSON only.';

    return prompt;
  }

  private parseNutritionResponse(content: string): NutritionAnalysis {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and sanitize the response
      return {
        calories: Math.max(0, Math.round(parsed.calories || 0)),
        protein_g: Math.max(0, Math.round((parsed.protein_g || 0) * 10) / 10),
        fat_g: Math.max(0, Math.round((parsed.fat_g || 0) * 10) / 10),
        carbs_g: Math.max(0, Math.round((parsed.carbs_g || 0) * 10) / 10),
        fiber_g: Math.max(0, Math.round((parsed.fiber_g || 0) * 10) / 10),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        advice_short: (parsed.advice_short || 'Записал приём пищи.').substring(0, 120),
      };
    } catch (error) {
      console.error('Error parsing nutrition response:', error);
      return this.getDefaultAnalysis('Не удалось разобрать ответ. Приблизительная оценка.');
    }
  }

  private getDefaultAnalysis(advice: string): NutritionAnalysis {
    return {
      calories: 300,
      protein_g: 15,
      fat_g: 10,
      carbs_g: 30,
      fiber_g: 3,
      confidence: 0.1,
      advice_short: advice,
    };
  }

  private detectImageMimeType(buffer: Buffer): string {
    // Check for common image formats by looking at file headers
    if (buffer.length < 4) return 'image/jpeg';

    const header = buffer.subarray(0, 4);
    
    // JPEG: FF D8 FF
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
      return 'image/jpeg';
    }
    
    // PNG: 89 50 4E 47
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
      return 'image/png';
    }
    
    // WebP: starts with RIFF
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return 'image/webp';
    }
    
    // Default to JPEG
    return 'image/jpeg';
  }

  /**
   * Generate daily summary advice based on nutrition data
   */
  async generateDailyAdvice(
    user: User,
    todayData: DailyEntry,
    recentDays: DailyEntry[]
  ): Promise<string> {
    try {
      const systemPrompt = `You are Soma, a supportive nutrition coach. Generate a brief daily summary advice in Russian (max 120 chars).

Focus on:
- Acknowledging progress
- Gentle suggestions for tomorrow
- Balance rather than restriction
- Positive reinforcement

Be encouraging and specific.`;

      const userPrompt = `User goals: ${user.cal_goal} kcal, ${user.protein_goal_g}g protein, ${user.fiber_goal_g}g fiber

Today: ${todayData.calories_sum} kcal, ${todayData.protein_sum}g protein, ${todayData.fiber_sum}g fiber, ${todayData.meals_count} meals

Recent trend (3 days avg): ${recentDays.length > 0 ? 
  `${Math.round(recentDays.reduce((sum, day) => sum + day.calories_sum, 0) / recentDays.length)} kcal, ` +
  `${Math.round(recentDays.reduce((sum, day) => sum + day.protein_sum, 0) / recentDays.length)}g protein, ` +
  `${Math.round(recentDays.reduce((sum, day) => sum + day.fiber_sum, 0) / recentDays.length)}g fiber`
  : 'No recent data'
}

Generate encouraging advice for tomorrow (max 120 chars in Russian).`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 100,
        temperature: 0.4,
      });

      const advice = response.choices[0]?.message?.content?.trim() || '';
      return advice.substring(0, 120);
    } catch (error) {
      console.error('Error generating daily advice:', error);
      return 'Продолжайте в том же духе! Завтра добавьте больше овощей.';
    }
  }
}
