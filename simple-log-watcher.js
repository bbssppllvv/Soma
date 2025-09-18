#!/usr/bin/env node

/**
 * Simple Local Log Watcher - No ngrok required
 * Shows how to integrate remote logging into your code
 */

import chalk from 'chalk';
import express from 'express';
import { createServer } from 'http';

const LOG_PORT = 3001;
const SECRET = 'dev-secret';

console.log(chalk.blue.bold('🔍 Simple Versailles Log Watcher'));
console.log(chalk.gray('─'.repeat(60)));

// Simple webhook server for receiving logs
const app = express();
app.use(express.json({ limit: '10mb' }));

// Color mapping for log levels
const levelColors = {
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray
};

// Format log for console display
function formatLog(log) {
  const timestamp = chalk.gray(new Date(log.timestamp).toLocaleTimeString());
  const level = levelColors[log.level] ? levelColors[log.level](log.level.toUpperCase().padEnd(5)) : log.level.toUpperCase().padEnd(5);
  const env = chalk.magenta(`[${log.environment || 'unknown'}]`);
  const region = chalk.cyan(`[${log.region || 'unknown'}]`);
  
  let message = log.message;
  
  // Highlight important patterns
  if (message.includes('[OFF]')) {
    message = message.replace('[OFF]', chalk.green.bold('[OFF]'));
  }
  if (message.includes('[GPT]')) {
    message = message.replace('[GPT]', chalk.purple.bold('[GPT]'));
  }
  if (message.includes('[METRIC]')) {
    message = message.replace('[METRIC]', chalk.blue.bold('[METRIC]'));
  }
  
  // Add meta information if available
  let metaStr = '';
  if (log.meta && Object.keys(log.meta).length > 0) {
    const importantKeys = ['stage', 'brand', 'score', 'products_found', 'duration_ms', 'error'];
    const importantMeta = {};
    
    importantKeys.forEach(key => {
      if (log.meta[key] !== undefined) {
        importantMeta[key] = log.meta[key];
      }
    });
    
    if (Object.keys(importantMeta).length > 0) {
      metaStr = chalk.gray(` ${JSON.stringify(importantMeta)}`);
    } else if (Object.keys(log.meta).length <= 3) {
      metaStr = chalk.gray(` ${JSON.stringify(log.meta)}`);
    } else {
      metaStr = chalk.gray(` {${Object.keys(log.meta).length} fields}`);
    }
  }

  return `${timestamp} ${level} ${env} ${region} ${message}${metaStr}`;
}

// Webhook endpoint to receive logs
app.post('/webhook/logs', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { logs, source } = req.body;
  
  if (!Array.isArray(logs)) {
    return res.status(400).json({ error: 'Invalid logs format' });
  }

  // Display logs in console
  if (logs.length > 0) {
    console.log(chalk.green(`\n📡 ${logs.length} logs from ${source}:`));
    logs.forEach(log => {
      console.log(formatLog(log));
    });
  }

  res.json({ received: logs.length });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start webhook server
const server = createServer(app);
server.listen(LOG_PORT, () => {
  console.log(chalk.green(`✅ Webhook server started on port ${LOG_PORT}`));
  console.log(chalk.blue(`📡 Local endpoint: http://localhost:${LOG_PORT}/webhook/logs`));
  console.log(chalk.yellow(`🔑 Secret: ${SECRET}\n`));
  
  console.log(chalk.yellow.bold('📋 Для получения логов из Vercel:'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.yellow('1. Нужен публичный URL (используйте ngrok или другой туннель)'));
  console.log(chalk.yellow('2. Или интегрируйте remoteLogger прямо в код'));
  console.log(chalk.gray('─'.repeat(50)));
  
  // Show integration example
  console.log(chalk.blue.bold('\n🔧 Интеграция в код (api/modules/nutrition/off-resolver.js):'));
  console.log(chalk.white(`
import remoteLogger from '../remote-logger.js';

// Заменить:
console.log('[OFF] Found products:', products.length);

// На:
remoteLogger.offLog('search', 'Found products', { count: products.length });
  `));
  
  console.log(chalk.green.bold('🎉 Готов принимать логи!'));
  console.log(chalk.gray('Для тестирования отправьте POST запрос на /webhook/logs\n'));
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Shutting down...'));
  server.close();
  process.exit(0);
});

// Show test command
setTimeout(() => {
  console.log(chalk.blue('💡 Для тестирования выполните в другом терминале:'));
  console.log(chalk.white(`curl -X POST http://localhost:${LOG_PORT}/webhook/logs \\
  -H "Authorization: Bearer ${SECRET}" \\
  -H "Content-Type: application/json" \\
  -d '{"logs":[{"timestamp":"${new Date().toISOString()}","level":"info","message":"[OFF] Test log","environment":"production","region":"fra1","meta":{"test":true}}],"source":"test"}'`));
}, 2000);
