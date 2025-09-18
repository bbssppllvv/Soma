#!/usr/bin/env node

/**
 * Demo: How to see REAL logs from your code
 * This simulates what happens when you integrate remoteLogger
 */

import remoteLogger from './api/modules/remote-logger.js';

// Override to send to local server for demo
process.env.LOCAL_LOG_WEBHOOK_URL = 'http://localhost:3001/webhook/logs';
process.env.LOG_WEBHOOK_SECRET = 'dev-secret';
process.env.VERCEL_ENV = 'production';
process.env.VERCEL_REGION = 'fra1';

console.log('🎭 Симуляция реальных логов из вашего кода...');
console.log('📺 Смотрите вывод в терминале с npm run watch-simple\n');

async function simulateRealWorkflow() {
  // Simulate user sending photo to bot
  remoteLogger.info('📸 User sent photo', { 
    user_id: 12345, 
    file_size: '2.3MB',
    telegram_message_id: 789 
  });

  await delay(500);

  // Simulate GPT analysis
  remoteLogger.gptLog('🧠 Starting image analysis', {
    model: 'gpt-4-vision',
    image_size: '1024x768',
    estimated_tokens: 1200
  });

  await delay(1200);

  remoteLogger.gptLog('✅ GPT analysis completed', {
    items_found: 2,
    confidence_avg: 0.87,
    processing_time_ms: 1200,
    items: ['Coca-Cola Zero', 'Chips']
  });

  await delay(300);

  // Simulate OFF resolution
  remoteLogger.offLog('resolve_start', '=== RESOLVING ITEM START ===');
  
  await delay(200);
  remoteLogger.offLog('input', 'Input item: Coca-Cola Zero', {
    brand: 'Coca-Cola',
    clean_name: 'cola',
    required_tokens: ['zero'],
    confidence: 0.9
  });

  await delay(600);
  remoteLogger.offLog('search', 'Search strategy found products', {
    strategy: 'brand_primary',
    products_found: 25,
    search_time_ms: 580
  });

  await delay(300);
  remoteLogger.offLog('scoring', 'Rerank top candidates', {
    top_score: 1070,
    candidates_total: 25,
    candidates_filtered: 18
  });

  await delay(200);
  remoteLogger.offLog('success', '✅ Product resolved successfully', {
    product_name: 'Coca-Cola Zero Sugar',
    product_code: '90357985',
    final_score: 1070,
    nutrition_data: true
  });

  await delay(800);

  // Simulate some warnings
  remoteLogger.warn('⚠️ Slow API response detected', {
    endpoint: 'openfoodfacts.org',
    response_time_ms: 3200,
    timeout_threshold_ms: 2000
  });

  await delay(400);

  // Simulate metrics
  remoteLogger.metric('telegram_message_processed', 1, {
    user_id: 12345,
    processing_time_ms: 3500,
    items_resolved: 2,
    success_rate: 1.0
  });

  await delay(600);

  // Simulate error handling
  remoteLogger.offLog('pipeline', 'Starting second item: Chips', {
    name: 'Lays Classic',
    brand: 'Lays',
    required_tokens: ['classic']
  });

  await delay(800);
  remoteLogger.error('❌ OFF API timeout', {
    stage: 'v2_strict',
    brand: 'lays',
    timeout_ms: 5000,
    retry_count: 2,
    error: 'Request timeout after 5000ms'
  });

  await delay(300);
  remoteLogger.offLog('fallback', 'Attempting fallback strategy', {
    original_strategy: 'v2_strict',
    fallback_strategy: 'brand_only',
    tokens_dropped: ['classic']
  });

  await delay(1000);
  remoteLogger.warn('⚠️ Fallback succeeded with lower confidence', {
    product_name: 'Lays Original',
    score: 450,
    confidence: 0.65,
    reason: 'fallback_match'
  });

  await delay(500);

  // Final summary
  remoteLogger.info('📊 Analysis complete', {
    total_items: 2,
    resolved_successfully: 2,
    fallback_used: 1,
    total_time_ms: 8900,
    user_notified: true
  });

  console.log('\n✨ Симуляция завершена!');
  console.log('💡 Чтобы получать такие логи из реального кода:');
  console.log('   1. Замените console.log на remoteLogger в своих модулях');
  console.log('   2. Настройте webhook URL в Vercel');
  console.log('   3. Запустите npm run watch-simple');
  
  // Graceful shutdown
  setTimeout(() => process.exit(0), 2000);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

simulateRealWorkflow().catch(console.error);
