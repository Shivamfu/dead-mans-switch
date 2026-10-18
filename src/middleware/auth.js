import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/index.js';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const apiKeyHeader = req.headers['x-api-key'];

    // 1. Check API Key
    const apiKey = apiKeyHeader || (authHeader.startsWith('Bearer dms_') ? authHeader.replace('Bearer ', '') : null);
    if (apiKey) {
      const userRes = await query('SELECT id, email, api_key FROM users WHERE api_key = $1', [apiKey]);
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
        req.authType = 'API_KEY';
        return next();
      }
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    // 2. Check JWT Bearer token
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        const userRes = await query('SELECT id, email, api_key FROM users WHERE id = $1', [decoded.userId]);
        if (userRes.rows.length === 0) {
          return res.status(401).json({ error: 'User associated with token not found.' });
        }
        req.user = userRes.rows[0];
        req.authType = 'JWT';
        return next();
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid or expired session token.' });
      }
    }

    return res.status(401).json({ error: 'Authentication required. Provide a Bearer token or X-API-Key header.' });
  } catch (err) {
    next(err);
  }
}
