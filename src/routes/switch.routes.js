import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { SwitchService } from '../services/switch.service.js';
import { query } from '../db/index.js';

const router = express.Router();

// Create a new Dead Man's Switch vault
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      name,
      description,
      payload,
      masterPassword,
      checkinIntervalSeconds,
      gracePeriodSeconds,
      contacts,
    } = req.body;

    if (!name || !payload) {
      return res.status(400).json({ error: 'Name and payload (notes/credentials) are required.' });
    }

    const sw = await SwitchService.createSwitch({
      userId: req.user.id,
      name,
      description,
      plaintextPayload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      masterPassword,
      checkinIntervalSeconds,
      gracePeriodSeconds,
      contacts: Array.isArray(contacts) ? contacts : [],
    });

    res.status(201).json({
      message: 'Dead Man\'s Switch created successfully.',
      switch: sw,
    });
  } catch (err) {
    next(err);
  }
});

// List all switches for current user
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const switches = await SwitchService.listUserSwitches(req.user.id);
    res.json({ switches });
  } catch (err) {
    next(err);
  }
});

// Get switch details by ID
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const sw = await SwitchService.getSwitchById(req.params.id);
    if (!sw) {
      return res.status(404).json({ error: 'Switch not found.' });
    }
    if (sw.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to view this switch.' });
    }

    res.json({ switch: sw });
  } catch (err) {
    next(err);
  }
});

// Delete switch
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await SwitchService.deleteSwitch(req.params.id, req.user.id);
    res.json({ message: 'Switch deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// Manual / Emergency Trigger (for verification or instant dispatch)
router.post('/:id/emergency-trigger', requireAuth, async (req, res, next) => {
  try {
    const sw = await SwitchService.getSwitchById(req.params.id);
    if (!sw) {
      return res.status(404).json({ error: 'Switch not found.' });
    }
    if (sw.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const result = await SwitchService.triggerDispatch(req.params.id, 'MANUAL_USER_TRIGGER');
    res.json({
      message: 'Switch emergency dispatch executed successfully.',
      result,
    });
  } catch (err) {
    next(err);
  }
});

// Testing helper: fast-forward switch to be DUE or in GRACE PERIOD
router.post('/:id/simulate-due', requireAuth, async (req, res, next) => {
  try {
    const pastDate = new Date(Date.now() - 5000).toISOString();
    await query(
      `UPDATE switches
       SET next_checkin_due_at = $1, status = 'ACTIVE'
       WHERE id = $2 AND user_id = $3`,
      [pastDate, req.params.id, req.user.id]
    );

    const sw = await SwitchService.getSwitchById(req.params.id);
    res.json({
      message: 'Switch due date fast-forwarded to past. Next evaluation will trigger check-in prompt.',
      switch: sw,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
