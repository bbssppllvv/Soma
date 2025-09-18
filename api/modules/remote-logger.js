/**
 * Remote Logger - Send logs from Vercel to local development environment
 * Allows real-time monitoring of production logs locally
 */

const LOG_WEBHOOK_URL = process.env.LOCAL_LOG_WEBHOOK_URL;
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

class RemoteLogger {
  constructor() {
    this.buffer = [];
    this.flushInterval = null;
    this.maxBufferSize = 100;
    this.flushIntervalMs = 2000;
    
    if (IS_PRODUCTION && LOG_WEBHOOK_URL) {
      this.startBuffering();
    }
  }

  startBuffering() {
    // Flush logs periodically
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  log(level, message, meta = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
      environment: process.env.VERCEL_ENV || 'unknown',
      region: process.env.VERCEL_REGION || 'unknown',
      deployment: process.env.VERCEL_URL || 'local'
    };

    // Always log to console
    const consoleMethod = level === 'error' ? 'error' : 
                         level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[${level.toUpperCase()}]`, message, meta);

    // Buffer for remote sending in production
    if (IS_PRODUCTION && LOG_WEBHOOK_URL) {
      this.buffer.push(logEntry);
      
      // Flush immediately for errors
      if (level === 'error' || this.buffer.length >= this.maxBufferSize) {
        this.flush();
      }
    }
  }

  async flush() {
    if (!this.buffer.length || !LOG_WEBHOOK_URL) return;

    const logsToSend = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch(LOG_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LOG_WEBHOOK_SECRET || 'dev-secret'}`
        },
        body: JSON.stringify({
          logs: logsToSend,
          source: 'vercel-api'
        }),
        timeout: 5000
      });

      if (!response.ok) {
        console.warn(`[RemoteLogger] Failed to send logs: ${response.status}`);
      }
    } catch (error) {
      console.warn(`[RemoteLogger] Error sending logs:`, error.message);
      // Re-add logs to buffer for retry
      this.buffer.unshift(...logsToSend.slice(-10)); // Keep last 10 for retry
    }
  }

  info(message, meta) {
    this.log('info', message, meta);
  }

  warn(message, meta) {
    this.log('warn', message, meta);
  }

  error(message, meta) {
    this.log('error', message, meta);
  }

  debug(message, meta) {
    this.log('debug', message, meta);
  }

  // Enhanced logging for OFF pipeline
  offLog(stage, message, meta = {}) {
    this.info(`[OFF] ${message}`, { stage, ...meta });
  }

  offError(stage, error, meta = {}) {
    this.error(`[OFF] ${stage} error: ${error.message}`, { 
      stage, 
      error: error.stack || error.message, 
      ...meta 
    });
  }

  // Enhanced logging for GPT analysis
  gptLog(message, meta = {}) {
    this.info(`[GPT] ${message}`, meta);
  }

  // Enhanced logging for metrics
  metric(name, value, labels = {}) {
    this.info(`[METRIC] ${name}`, { value, ...labels });
  }

  cleanup() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flush(); // Final flush
    }
  }
}

// Singleton instance
const remoteLogger = new RemoteLogger();

// Graceful shutdown
process.on('SIGTERM', () => remoteLogger.cleanup());
process.on('SIGINT', () => remoteLogger.cleanup());

export default remoteLogger;

// Convenience exports
export const { info, warn, error, debug, offLog, offError, gptLog, metric } = remoteLogger;
