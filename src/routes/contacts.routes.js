import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { SwitchService } from '../services/switch.service.js';
import { query } from '../db/index.js';

const router = express.Router();

// Add a trusted contact to a switch
router.post('/:id/contacts', requireAuth, async (req, res, next) => {
  try {
    const sw = await SwitchService.getSwitchById(req.params.id);
    if (!sw) return res.status(404).json({ error: 'Switch not found.' });
    if (sw.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized.' });

    const { name, email, relationship, customMessage, contactKeyShare } = req.body;
    if (!email) return res.status(400).json({ error: 'Contact email is required.' });

    const insertSql = `
      INSERT INTO trusted_contacts (switch_id, name, email, relationship, custom_message, contact_key_share)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await query(insertSql, [
      sw.id,
      name || 'Trusted Contact',
      email,
      relationship || 'Emergency Contact',
      customMessage || '',
      contactKeyShare || null,
    ]);

    res.status(201).json({
      message: 'Contact added successfully.',
      contact: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// Remove a trusted contact
router.delete('/:id/contacts/:contactId', requireAuth, async (req, res, next) => {
  try {
    const sw = await SwitchService.getSwitchById(req.params.id);
    if (!sw) return res.status(404).json({ error: 'Switch not found.' });
    if (sw.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized.' });

    await query('DELETE FROM trusted_contacts WHERE id = $1 AND switch_id = $2', [
      req.params.contactId,
      sw.id,
    ]);

    res.json({ message: 'Contact removed successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
