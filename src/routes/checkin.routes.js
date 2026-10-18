import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { SwitchService } from '../services/switch.service.js';

const router = express.Router();

// Authenticated ping via API (curl, scheduled script, or dashboard)
router.post('/api/checkin/:id/ping', requireAuth, async (req, res, next) => {
  try {
    const switchId = req.params.id;
    const sw = await SwitchService.getSwitchById(switchId);

    if (!sw) {
      return res.status(404).json({ error: 'Switch not found.' });
    }
    if (sw.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to ping this switch.' });
    }

    const updated = await SwitchService.processCheckin(
      switchId,
      req.authType === 'API_KEY' ? 'API_KEY_PING' : 'JWT_PING',
      req.ip || '127.0.0.1'
    );

    res.json({
      message: 'Check-in confirmed successfully. Timer reset.',
      switch: updated,
    });
  } catch (err) {
    next(err);
  }
});

// 1-Click Email Check-in Link handler (GET /checkin/:token)
router.get('/checkin/:token', async (req, res) => {
  const { token } = req.params;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

  try {
    const updatedSwitch = await SwitchService.verifyTokenAndCheckin(token, clientIp);

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check-in Confirmed | Dead Man's Switch</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #090d16;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .icon {
      width: 64px;
      height: 64px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 32px;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    h1 {
      font-size: 24px;
      margin-bottom: 12px;
      color: #ffffff;
    }
    p {
      color: #94a3b8;
      font-size: 15px;
      line-height: 1.6;
    }
    .badge {
      display: inline-block;
      background: #1e293b;
      color: #38bdf8;
      padding: 8px 16px;
      border-radius: 20px;
      font-family: monospace;
      font-size: 14px;
      margin: 20px 0;
    }
    .btn {
      display: inline-block;
      background: #0284c7;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      margin-top: 16px;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #0369a1;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Check-in Confirmed</h1>
    <p>Your authenticated heartbeat has been recorded. The timer for recovery switch <strong>"${updatedSwitch.name}"</strong> has been successfully reset.</p>
    <div class="badge">Next Check-in: ${new Date(updatedSwitch.next_checkin_due_at).toLocaleString()}</div>
    <div>
      <a href="/" class="btn">Return to Vault Dashboard</a>
    </div>
  </div>
</body>
</html>
    `);
  } catch (err) {
    res.status(400).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invalid Token | Dead Man's Switch</title>
  <style>
    body {
      background: #090d16;
      font-family: sans-serif;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #0f172a;
      border: 1px solid #7f1d1d;
      border-radius: 16px;
      padding: 40px;
      max-width: 450px;
      text-align: center;
    }
    .icon {
      color: #ef4444;
      font-size: 40px;
      margin-bottom: 16px;
    }
    h1 { color: #f87171; font-size: 22px; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Check-in Link Expired or Invalid</h1>
    <p>${err.message}</p>
    <p><a href="/">Return to Dashboard</a></p>
  </div>
</body>
</html>
    `);
  }
});

export default router;
