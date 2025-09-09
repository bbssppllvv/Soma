import { VercelRequest, VercelResponse } from '@vercel/node';
import { sheetsService } from '../services/sheets';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test database connectivity
    const users = await sheetsService.getAllUsersForDigest();
    
    // Basic system info
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: 'connected',
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
        sheets: process.env.GOOGLE_SERVICE_ACCOUNT ? 'configured' : 'missing'
      },
      stats: {
        totalUsers: users.length,
        activeUsers: users.filter(u => !u.silent_mode).length
      }
    };

    return res.status(200).json(health);
  } catch (error) {
    console.error('Health check failed:', error);
    
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      services: {
        database: 'disconnected',
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
        sheets: process.env.GOOGLE_SERVICE_ACCOUNT ? 'configured' : 'missing'
      }
    });
  }
}
