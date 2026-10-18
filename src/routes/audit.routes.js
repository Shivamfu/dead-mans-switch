import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AuditService } from '../services/audit.service.js';
import { emailService } from '../services/email.service.js';
import { runEvaluationCycle } from '../queues/cron.js';

const router = express.Router();

// Retrieve security audit logs
router.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const switchId = req.query.switchId || null;
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await AuditService.getLogs(switchId, limit);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// Retrieve live recent email notifications (inbox view for testing/UI inspection)
router.get('/recent-emails', requireAuth, (req, res) => {
  const emails = emailService.getRecentEmails();
  res.json({ emails });
});

// Manually trigger the scheduled evaluation cycle (for testing/demo)
router.post('/evaluate-now', requireAuth, async (req, res, next) => {
  try {
    await runEvaluationCycle();
    res.json({ message: 'Evaluation cycle completed successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
