#!/usr/bin/env node

/**
 * Watch Versailles - Simple script to view production logs in console
 * Just run: npm run watch-versailles
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import { createServer } from 'http';
import express from 'express';

const LOG_PORT = 3001;
const SECRET = 'dev-secret';

console.log(chalk.blue.bold('🔍 Versailles Log Watcher'));
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
    // Format meta more compactly for console
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

  // Display logs in console with separator
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
  console.log(chalk.blue(`📡 Endpoint: http://localhost:${LOG_PORT}/webhook/logs`));
  console.log(chalk.yellow(`🔑 Secret: ${SECRET}\n`));
});

// Start ngrok tunnel automatically
console.log(chalk.yellow('🚀 Starting ngrok tunnel...'));
const ngrok = spawn('npx', ['ngrok', 'http', LOG_PORT, '--log=stdout'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let tunnelUrl = null;
let setupComplete = false;

// Parse ngrok output to find tunnel URL
ngrok.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Look for tunnel URL in ngrok output
  const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.ngrok\.io/);
  if (urlMatch && !tunnelUrl) {
    tunnelUrl = urlMatch[0];
    console.log(chalk.green(`✅ Tunnel active: ${tunnelUrl}`));
    
    if (!setupComplete) {
      showSetupInstructions();
      setupComplete = true;
    }
  }
});

ngrok.stderr.on('data', (data) => {
  const output = data.toString();
  if (output.includes('ERROR') || output.includes('WARN')) {
    console.log(chalk.red('🚨 ngrok error:'), output.trim());
  }
});

ngrok.on('close', (code) => {
  console.log(chalk.yellow(`\n🔌 ngrok tunnel closed (code: ${code})`));
  if (code !== 0) {
    console.log(chalk.red('❌ ngrok failed. You might need to install it:'));
    console.log(chalk.blue('   npm install -g @ngrok/ngrok'));
    console.log(chalk.blue('   or use: npx ngrok http 3001'));
  }
});

function showSetupInstructions() {
  console.log(chalk.blue.bold('\n📋 Setup Instructions for Vercel:'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.yellow('1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables'));
  console.log(chalk.yellow('2. Add these variables:'));
  console.log(chalk.white(`   LOCAL_LOG_WEBHOOK_URL=${tunnelUrl}/webhook/logs`));
  console.log(chalk.white(`   LOG_WEBHOOK_SECRET=${SECRET}`));
  console.log(chalk.yellow('3. Redeploy your project or wait for next deployment'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.green.bold('🎉 Ready! Logs will appear below when received from Versailles.\n'));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Shutting down...'));
  ngrok.kill();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n👋 Shutting down...'));
  ngrok.kill();
  server.close();
  process.exit(0);
});

// Show initial status
setTimeout(() => {
  if (!tunnelUrl) {
    console.log(chalk.yellow('⏳ Waiting for ngrok tunnel to start...'));
    console.log(chalk.gray('   This might take a few seconds...'));
  }
}, 3000);

// Keep process alive
process.stdin.resume();
