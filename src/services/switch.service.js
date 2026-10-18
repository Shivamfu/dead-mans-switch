import { query } from '../db/index.js';
import {
  encrypt,
  decrypt,
  envelopeEncrypt,
  envelopeDecrypt,
  generateRandomKeyHex,
} from '../crypto/cipher.js';
import { generateSecureToken, hashToken } from '../crypto/tokens.js';
import { emailService } from './email.service.js';
import { AuditService } from './audit.service.js';
import { config } from '../config.js';

export class SwitchService {
  /**
   * Creates a new dead man's switch recovery vault
   */
  static async createSwitch({
    userId,
    name,
    description = '',
    plaintextPayload,
    masterPassword = null,
    checkinIntervalSeconds = config.defaults.checkinIntervalSeconds,
    gracePeriodSeconds = config.defaults.gracePeriodSeconds,
    contacts = [],
  }) {
    if (!name || !plaintextPayload) {
      throw new Error('Name and plaintextPayload are required.');
    }

    const interval = parseInt(checkinIntervalSeconds, 10) || config.defaults.checkinIntervalSeconds;
    const grace = parseInt(gracePeriodSeconds, 10) || config.defaults.gracePeriodSeconds;

    // Next check-in is due interval seconds from now
    const nextCheckinDueAt = new Date(Date.now() + interval * 1000).toISOString();

    // Use envelope encryption:
    // Payload encrypted with unique item DEK, DEK encrypted with system or master key
    const keySource = masterPassword || config.systemMasterSalt;
    const envelope = envelopeEncrypt(plaintextPayload, keySource);

    // Save switch record
    const insertSwitchSql = `
      INSERT INTO switches (
        user_id, name, description, status,
        checkin_interval_seconds, grace_period_seconds,
        last_checkin_at, next_checkin_due_at,
        encrypted_payload, payload_iv, payload_tag,
        encryption_algorithm, key_release_mode,
        encrypted_recovery_key, created_at, updated_at
      ) VALUES ($1, $2, $3, 'ACTIVE', $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *
    `;

    // Storing encrypted DEK and IV/tag in encrypted_recovery_key as JSON string
    const recoveryKeyData = JSON.stringify({
      encryptedKey: envelope.encryptedKey,
      keyIv: envelope.keyIv,
      keyTag: envelope.keyTag,
      rawKeyHex: envelope.rawKeyHex, // Held securely for emergency unsealing
    });

    const res = await query(insertSwitchSql, [
      userId,
      name,
      description,
      interval,
      grace,
      nextCheckinDueAt,
      envelope.encryptedPayload,
      envelope.iv,
      envelope.tag,
      'AES-256-GCM',
      'ENVELOPE_KEY_RELEASE',
      recoveryKeyData,
    ]);

    const createdSwitch = res.rows[0];

    // Add designated trusted contacts
    const insertedContacts = [];
    for (const c of contacts) {
      if (!c.email) continue;
      const contactSql = `
        INSERT INTO trusted_contacts (switch_id, name, email, relationship, custom_message, contact_key_share)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const contactRes = await query(contactSql, [
        createdSwitch.id,
        c.name || 'Trusted Contact',
        c.email,
        c.relationship || 'Emergency Contact',
        c.customMessage || '',
        c.contactKeyShare || null,
      ]);
      insertedContacts.push(contactRes.rows[0]);
    }

    await AuditService.log(
      createdSwitch.id,
      'SWITCH_CREATED',
      'INFO',
      {
        switchId: createdSwitch.id,
        name: createdSwitch.name,
        intervalSeconds: interval,
        graceSeconds: grace,
        contactCount: insertedContacts.length,
      }
    );

    return {
      ...createdSwitch,
      contacts: insertedContacts,
    };
  }

  /**
   * Retrieves switch details with associated contacts and audit logs
   */
  static async getSwitchById(switchId) {
    const swRes = await query('SELECT * FROM switches WHERE id = $1', [switchId]);
    if (swRes.rows.length === 0) return null;

    const sw = swRes.rows[0];
    const contactsRes = await query('SELECT * FROM trusted_contacts WHERE switch_id = $1', [switchId]);
    const auditRes = await query(
      'SELECT * FROM audit_logs WHERE switch_id = $1 ORDER BY created_at DESC LIMIT 20',
      [switchId]
    );

    return {
      ...sw,
      contacts: contactsRes.rows,
      auditLogs: auditRes.rows,
    };
  }

  /**
   * Lists all switches for a user
   */
  static async listUserSwitches(userId) {
    const res = await query('SELECT * FROM switches WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    const switches = res.rows;

    for (const sw of switches) {
      const contactsRes = await query('SELECT * FROM trusted_contacts WHERE switch_id = $1', [sw.id]);
      sw.contacts = contactsRes.rows;
    }

    return switches;
  }

  /**
   * Authenticated Check-in / Ping
   * Resets deadlines, clears warnings, restores ACTIVE status
   */
  static async processCheckin(switchId, method = 'API_PING', ipAddress = '127.0.0.1') {
    const swRes = await query('SELECT * FROM switches WHERE id = $1', [switchId]);
    if (swRes.rows.length === 0) {
      throw new Error(`Switch not found: ${switchId}`);
    }

    const sw = swRes.rows[0];
    if (sw.status === 'TRIGGERED') {
      throw new Error('Switch has already been triggered and dispatched. Cannot reset.');
    }

    const now = new Date();
    const nextCheckinDueAt = new Date(now.getTime() + sw.checkin_interval_seconds * 1000).toISOString();

    const updateSql = `
      UPDATE switches
      SET status = 'ACTIVE',
          last_checkin_at = NOW(),
          next_checkin_due_at = $1,
          grace_period_ends_at = NULL,
          reminder_sent_at = NULL,
          warning_count = 0,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const updatedRes = await query(updateSql, [nextCheckinDueAt, switchId]);
    const updatedSwitch = updatedRes.rows[0];

    await AuditService.log(
      switchId,
      'CHECKIN_PING_RECEIVED',
      'INFO',
      {
        method,
        previousStatus: sw.status,
        newStatus: 'ACTIVE',
        nextCheckinDueAt,
      },
      ipAddress
    );

    return updatedSwitch;
  }

  /**
   * Generates a 1-click check-in token and sends notification email
   */
  static async sendCheckinPrompt(switchId) {
    const sw = await this.getSwitchById(switchId);
    if (!sw || sw.status === 'TRIGGERED') return;

    // Fetch switch owner email
    const userRes = await query('SELECT email FROM users WHERE id = $1', [sw.user_id]);
    const ownerEmail = userRes.rows[0]?.email;
    if (!ownerEmail) return;

    // Generate single-use random token
    const rawToken = generateSecureToken();
    const tokenHashStr = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 86400 * 7 * 1000).toISOString(); // 7 days expiry

    await query(
      `INSERT INTO checkin_tokens (switch_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [switchId, tokenHashStr, expiresAt]
    );

    const checkinUrl = `${config.appUrl}/checkin/${rawToken}`;
    const graceHours = (sw.grace_period_seconds / 3600).toFixed(1);

    // Send check-in email prompt
    await emailService.sendCheckinPrompt({
      to: ownerEmail,
      switchName: sw.name,
      switchId: sw.id,
      checkinUrl,
      dueDate: sw.next_checkin_due_at,
      gracePeriodHours: graceHours,
    });

    // Compute grace period end date
    const graceEndsAt = new Date(Date.now() + sw.grace_period_seconds * 1000).toISOString();

    await query(
      `UPDATE switches
       SET status = 'PENDING_CHECKIN',
           reminder_sent_at = NOW(),
           grace_period_ends_at = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [graceEndsAt, switchId]
    );

    await AuditService.log(switchId, 'CHECKIN_PROMPT_SENT', 'WARNING', {
      ownerEmail,
      graceEndsAt,
    });
  }

  /**
   * Sends urgent grace period warning when check-in is overdue
   */
  static async sendGraceWarning(switchId) {
    const sw = await this.getSwitchById(switchId);
    if (!sw || sw.status === 'TRIGGERED') return;

    const userRes = await query('SELECT email FROM users WHERE id = $1', [sw.user_id]);
    const ownerEmail = userRes.rows[0]?.email;
    if (!ownerEmail) return;

    const rawToken = generateSecureToken();
    const tokenHashStr = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 86400 * 7 * 1000).toISOString();

    await query(
      `INSERT INTO checkin_tokens (switch_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [switchId, tokenHashStr, expiresAt]
    );

    const checkinUrl = `${config.appUrl}/checkin/${rawToken}`;
    const remainingMs = Math.max(0, new Date(sw.grace_period_ends_at || Date.now()).getTime() - Date.now());
    const remainingHours = (remainingMs / (1000 * 3600)).toFixed(1);

    await emailService.sendGracePeriodWarning({
      to: ownerEmail,
      switchName: sw.name,
      switchId: sw.id,
      checkinUrl,
      graceEndsAt: sw.grace_period_ends_at,
      remainingHours,
    });

    await query(
      `UPDATE switches
       SET status = 'GRACE_PERIOD',
           warning_count = warning_count + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [switchId]
    );

    await AuditService.log(switchId, 'GRACE_PERIOD_WARNING_SENT', 'CRITICAL', {
      warningNumber: (sw.warning_count || 0) + 1,
      remainingHours,
    });
  }

  /**
   * Executes recovery dispatch when switch grace period expires or manual emergency trigger
   */
  static async triggerDispatch(switchId, reason = 'GRACE_PERIOD_EXPIRED') {
    const sw = await this.getSwitchById(switchId);
    if (!sw) throw new Error(`Switch not found: ${switchId}`);

    if (sw.status === 'TRIGGERED') {
      console.log(`[Switch] Switch ${switchId} already triggered.`);
      return sw;
    }

    const userRes = await query('SELECT email FROM users WHERE id = $1', [sw.user_id]);
    const ownerEmail = userRes.rows[0]?.email || 'Vault Owner';

    // Transition switch to TRIGGERED
    await query(
      `UPDATE switches
       SET status = 'TRIGGERED',
           updated_at = NOW()
       WHERE id = $1`,
      [switchId]
    );

    await AuditService.log(switchId, 'SWITCH_TRIGGERED', 'CRITICAL', {
      reason,
      triggeredAt: new Date().toISOString(),
    });

    // Unseal and decrypt the payload
    let decryptedPayload = '';
    let recoveryKeyHex = null;

    try {
      const keyData = JSON.parse(sw.encrypted_recovery_key || '{}');
      recoveryKeyHex = keyData.rawKeyHex;

      if (recoveryKeyHex) {
        decryptedPayload = decrypt(
          sw.encrypted_payload,
          sw.payload_iv,
          sw.payload_tag,
          recoveryKeyHex
        );
      } else {
        // Direct envelope decryption fallback
        decryptedPayload = envelopeDecrypt(
          sw.encrypted_payload,
          sw.payload_iv,
          sw.payload_tag,
          keyData.encryptedKey,
          keyData.keyIv,
          keyData.keyTag,
          config.systemMasterSalt
        );
      }
    } catch (decryptErr) {
      console.error(`[Switch] Payload decryption error for ${switchId}:`, decryptErr.message);
      decryptedPayload = `[ENCRYPTED PAYLOAD ATTACHMENT]\nCiphertext: ${sw.encrypted_payload}\n(Use designated contact key share to decrypt)`;
    }

    // Dispatch recovery packages to each designated trusted contact
    const dispatchResults = [];
    for (const contact of sw.contacts) {
      try {
        const sendResult = await emailService.sendRecoveryDispatch({
          to: contact.email,
          contactName: contact.name,
          ownerEmail,
          switchName: sw.name,
          customMessage: contact.custom_message,
          decryptedPayload,
          recoveryKeyHex,
        });

        await query(
          `UPDATE trusted_contacts
           SET notification_status = 'SENT',
               dispatched_at = NOW()
           WHERE id = $1`,
          [contact.id]
        );

        dispatchResults.push({
          contactId: contact.id,
          email: contact.email,
          status: 'SENT',
          messageId: sendResult.messageId,
        });

        await AuditService.log(switchId, 'PAYLOAD_DISPATCHED', 'CRITICAL', {
          contactId: contact.id,
          recipient: contact.email,
          deliveryStatus: 'SENT',
        });
      } catch (err) {
        console.error(`[Switch] Failed dispatching recovery package to ${contact.email}:`, err.message);
        await query(
          `UPDATE trusted_contacts
           SET notification_status = 'FAILED'
           WHERE id = $1`,
          [contact.id]
        );
        dispatchResults.push({
          contactId: contact.id,
          email: contact.email,
          status: 'FAILED',
          error: err.message,
        });
      }
    }

    return {
      switchId,
      status: 'TRIGGERED',
      dispatchedCount: dispatchResults.filter((r) => r.status === 'SENT').length,
      dispatches: dispatchResults,
    };
  }

  /**
   * Verifies a 1-click token and performs check-in
   */
  static async verifyTokenAndCheckin(rawToken, ipAddress = '127.0.0.1') {
    const tokenHashStr = hashToken(rawToken);
    const tokenRes = await query(
      `SELECT * FROM checkin_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHashStr]
    );

    if (tokenRes.rows.length === 0) {
      throw new Error('Check-in token is invalid, expired, or has already been used.');
    }

    const tokenRecord = tokenRes.rows[0];

    // Mark token as used
    await query('UPDATE checkin_tokens SET used_at = NOW() WHERE id = $1', [tokenRecord.id]);

    // Execute check-in
    const sw = await this.processCheckin(tokenRecord.switch_id, '1_CLICK_EMAIL_LINK', ipAddress);
    return sw;
  }

  /**
   * Deletes a switch and all associated data
   */
  static async deleteSwitch(switchId, userId) {
    const sw = await this.getSwitchById(switchId);
    if (!sw || sw.user_id !== userId) {
      throw new Error('Switch not found or unauthorized.');
    }

    await query('DELETE FROM switches WHERE id = $1', [switchId]);
    await AuditService.log(switchId, 'SWITCH_DELETED', 'WARNING', { name: sw.name });
    return true;
  }
}
