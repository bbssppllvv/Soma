#!/usr/bin/env node

/**
 * Local Log Server - Receive and display logs from Vercel deployment
 * Run this locally to see production logs in real-time
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import chalk from 'chalk';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.LOG_SERVER_PORT || 3001;
const SECRET = process.env.LOG_WEBHOOK_SECRET || 'dev-secret';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store recent logs in memory
const recentLogs = [];
const MAX_STORED_LOGS = 1000;

// Color mapping for log levels
const levelColors = {
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray
};

// Format log for console display
function formatLogForConsole(log) {
  const timestamp = chalk.gray(new Date(log.timestamp).toLocaleTimeString());
  const level = levelColors[log.level] ? levelColors[log.level](log.level.toUpperCase()) : log.level.toUpperCase();
  const env = chalk.magenta(`[${log.environment}]`);
  const region = chalk.cyan(`[${log.region}]`);
  
  let metaStr = '';
  if (log.meta && Object.keys(log.meta).length > 0) {
    metaStr = chalk.gray(` ${JSON.stringify(log.meta)}`);
  }

  return `${timestamp} ${level} ${env} ${region} ${log.message}${metaStr}`;
}

// Webhook endpoint to receive logs from Vercel
app.post('/webhook/logs', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { logs, source } = req.body;
  
  if (!Array.isArray(logs)) {
    return res.status(400).json({ error: 'Invalid logs format' });
  }

  console.log(chalk.green(`\n📡 Received ${logs.length} logs from ${source}:`));
  console.log(chalk.gray('─'.repeat(80)));

  logs.forEach(log => {
    // Add to recent logs
    recentLogs.push(log);
    if (recentLogs.length > MAX_STORED_LOGS) {
      recentLogs.shift();
    }

    // Display in console
    console.log(formatLogForConsole(log));

    // Emit to connected web clients
    io.emit('log', log);
  });

  console.log(chalk.gray('─'.repeat(80)));

  res.json({ received: logs.length });
});

// Web interface to view logs
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Soma Diet Tracker - Live Logs</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background: #1a1a1a;
            color: #f0f0f0;
            margin: 0;
            padding: 20px;
            line-height: 1.4;
        }
        .header {
            background: #2d2d2d;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #4CAF50;
        }
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        .stat {
            background: #2d2d2d;
            padding: 10px 15px;
            border-radius: 6px;
            border-left: 3px solid #2196F3;
        }
        .logs {
            background: #000;
            padding: 15px;
            border-radius: 8px;
            height: 70vh;
            overflow-y: auto;
            border: 1px solid #333;
        }
        .log-entry {
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            border-left: 3px solid transparent;
        }
        .log-info { border-left-color: #2196F3; }
        .log-warn { border-left-color: #FF9800; background: rgba(255, 152, 0, 0.1); }
        .log-error { border-left-color: #f44336; background: rgba(244, 67, 54, 0.1); }
        .log-debug { border-left-color: #666; color: #999; }
        .timestamp { color: #666; font-size: 0.9em; }
        .level { font-weight: bold; text-transform: uppercase; margin-right: 10px; }
        .level-info { color: #2196F3; }
        .level-warn { color: #FF9800; }
        .level-error { color: #f44336; }
        .level-debug { color: #999; }
        .env { color: #9C27B0; margin-right: 10px; }
        .region { color: #00BCD4; margin-right: 10px; }
        .message { color: #f0f0f0; }
        .meta { color: #999; font-size: 0.9em; margin-top: 4px; }
        .controls {
            margin-bottom: 20px;
        }
        button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
        }
        button:hover { background: #45a049; }
        .filter {
            background: #2d2d2d;
            color: #f0f0f0;
            border: 1px solid #555;
            padding: 6px 12px;
            border-radius: 4px;
            margin-right: 10px;
        }
        .status {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9em;
        }
        .status.disconnected {
            background: #f44336;
        }
    </style>
</head>
<body>
    <div class="status" id="status">🔗 Connected</div>
    
    <div class="header">
        <h1>🍎 Soma Diet Tracker - Live Production Logs</h1>
        <p>Real-time logs from Vercel deployment</p>
    </div>

    <div class="stats">
        <div class="stat">
            <strong>Total Logs:</strong> <span id="totalLogs">0</span>
        </div>
        <div class="stat">
            <strong>Errors:</strong> <span id="errorCount">0</span>
        </div>
        <div class="stat">
            <strong>Last Update:</strong> <span id="lastUpdate">Never</span>
        </div>
    </div>

    <div class="controls">
        <button onclick="clearLogs()">Clear Logs</button>
        <button onclick="scrollToBottom()">Scroll to Bottom</button>
        <select class="filter" id="levelFilter" onchange="filterLogs()">
            <option value="">All Levels</option>
            <option value="error">Errors Only</option>
            <option value="warn">Warnings+</option>
            <option value="info">Info+</option>
        </select>
        <input type="text" class="filter" id="searchFilter" placeholder="Search logs..." oninput="filterLogs()">
    </div>

    <div class="logs" id="logs"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const logsContainer = document.getElementById('logs');
        const statusEl = document.getElementById('status');
        const totalLogsEl = document.getElementById('totalLogs');
        const errorCountEl = document.getElementById('errorCount');
        const lastUpdateEl = document.getElementById('lastUpdate');
        
        let allLogs = [];
        let errorCount = 0;

        socket.on('connect', () => {
            statusEl.textContent = '🔗 Connected';
            statusEl.className = 'status';
        });

        socket.on('disconnect', () => {
            statusEl.textContent = '❌ Disconnected';
            statusEl.className = 'status disconnected';
        });

        socket.on('log', (log) => {
            allLogs.push(log);
            if (log.level === 'error') errorCount++;
            
            updateStats();
            renderLogs();
            scrollToBottom();
        });

        function updateStats() {
            totalLogsEl.textContent = allLogs.length;
            errorCountEl.textContent = errorCount;
            lastUpdateEl.textContent = new Date().toLocaleTimeString();
        }

        function formatLog(log) {
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            const metaStr = log.meta && Object.keys(log.meta).length > 0 ? 
                JSON.stringify(log.meta, null, 2) : '';
            
            return \`
                <div class="log-entry log-\${log.level}">
                    <div>
                        <span class="timestamp">\${timestamp}</span>
                        <span class="level level-\${log.level}">\${log.level}</span>
                        <span class="env">[\${log.environment}]</span>
                        <span class="region">[\${log.region}]</span>
                        <span class="message">\${log.message}</span>
                    </div>
                    \${metaStr ? \`<div class="meta">\${metaStr}</div>\` : ''}
                </div>
            \`;
        }

        function renderLogs() {
            const levelFilter = document.getElementById('levelFilter').value;
            const searchFilter = document.getElementById('searchFilter').value.toLowerCase();
            
            let filteredLogs = allLogs;
            
            if (levelFilter) {
                const levels = { error: 0, warn: 1, info: 2, debug: 3 };
                const filterLevel = levels[levelFilter];
                filteredLogs = filteredLogs.filter(log => levels[log.level] <= filterLevel);
            }
            
            if (searchFilter) {
                filteredLogs = filteredLogs.filter(log => 
                    log.message.toLowerCase().includes(searchFilter) ||
                    JSON.stringify(log.meta).toLowerCase().includes(searchFilter)
                );
            }
            
            logsContainer.innerHTML = filteredLogs.map(formatLog).join('');
        }

        function clearLogs() {
            allLogs = [];
            errorCount = 0;
            updateStats();
            renderLogs();
        }

        function scrollToBottom() {
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }

        function filterLogs() {
            renderLogs();
        }

        // Auto-scroll to bottom initially
        setTimeout(scrollToBottom, 100);
    </script>
</body>
</html>
  `);
});

// API endpoint to get recent logs
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const level = req.query.level;
  
  let logs = recentLogs;
  
  if (level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const filterLevel = levels[level];
    if (filterLevel !== undefined) {
      logs = logs.filter(log => levels[log.level] <= filterLevel);
    }
  }
  
  res.json({
    logs: logs.slice(-limit),
    total: recentLogs.length
  });
});

// Handle WebSocket connections
io.on('connection', (socket) => {
  console.log(chalk.green('🔌 Web client connected'));
  
  // Send recent logs to new client
  socket.emit('initialLogs', recentLogs.slice(-50));
  
  socket.on('disconnect', () => {
    console.log(chalk.yellow('🔌 Web client disconnected'));
  });
});

server.listen(PORT, () => {
  console.log(chalk.green('🚀 Log Server started!'));
  console.log(chalk.blue(`📡 Webhook endpoint: http://localhost:${PORT}/webhook/logs`));
  console.log(chalk.blue(`🌐 Web interface: http://localhost:${PORT}`));
  console.log(chalk.blue(`📊 API endpoint: http://localhost:${PORT}/api/logs`));
  console.log(chalk.gray(`🔑 Secret: ${SECRET}`));
  console.log(chalk.yellow('\n💡 To receive logs from Vercel, set these environment variables:'));
  console.log(chalk.yellow(`   LOCAL_LOG_WEBHOOK_URL=http://your-tunnel-url.ngrok.io/webhook/logs`));
  console.log(chalk.yellow(`   LOG_WEBHOOK_SECRET=${SECRET}`));
  console.log(chalk.gray('\n🔍 Waiting for logs from production...'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n👋 Shutting down log server...'));
  server.close();
});
