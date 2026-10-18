import { query } from '../db/index.js';

export class AuditService {
  /**
   * Records a security or lifecycle event
   * @param {string|null} switchId
   * @param {string} eventType e.g. 'SWITCH_CREATED', 'CHECKIN_PING', 'GRACE_WARNING', 'SWITCH_TRIGGERED', 'PAYLOAD_DISPATCHED'
   * @param {string} severity 'INFO' | 'WARNING' | 'CRITICAL'
   * @param {object} details
   * @param {string} [ipAddress]
   */
  static async log(switchId, eventType, severity = 'INFO', details = {}, ipAddress = '127.0.0.1') {
    try {
      const sql = `
        INSERT INTO audit_logs (switch_id, event_type, severity, details, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `;
      const res = await query(sql, [switchId, eventType, severity, JSON.stringify(details), ipAddress]);
      console.log(`[Audit] [${severity}] ${eventType}:`, details);
      return res.rows[0];
    } catch (err) {
      console.error('[Audit] Failed to persist audit log:', err.message);
    }
  }

  /**
   * Fetches the latest audit logs
   */
  static async getLogs(switchId = null, limit = 50) {
    if (switchId) {
      const sql = `
        SELECT * FROM audit_logs
        WHERE switch_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      const res = await query(sql, [switchId, limit]);
      return res.rows;
    }

    const sql = `
      SELECT * FROM audit_logs
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  }
}
