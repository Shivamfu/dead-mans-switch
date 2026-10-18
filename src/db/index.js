import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory fallback store when PostgreSQL server is not reachable
class InMemoryDatabase {
  constructor() {
    this.tables = {
      users: [],
      switches: [],
      trusted_contacts: [],
      checkin_tokens: [],
      audit_logs: [],
    };
    this.isFallback = true;
  }

  generateUuid() {
    return crypto.randomUUID();
  }

  async query(text, params = []) {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    // 1. SELECT queries
    if (upper.startsWith('SELECT')) {
      if (upper.includes('FROM USERS')) {
        let results = [...this.tables.users];
        if (upper.includes('WHERE EMAIL = $1')) {
          results = results.filter((u) => u.email.toLowerCase() === (params[0] || '').toLowerCase());
        } else if (upper.includes('WHERE ID = $1')) {
          results = results.filter((u) => u.id === params[0]);
        } else if (upper.includes('WHERE API_KEY = $1')) {
          results = results.filter((u) => u.api_key === params[0]);
        }
        return { rows: results, rowCount: results.length };
      }

      if (upper.includes('FROM SWITCHES')) {
        let results = [...this.tables.switches];
        if (upper.includes('WHERE ID = $1')) {
          results = results.filter((s) => s.id === params[0]);
        } else if (upper.includes('WHERE USER_ID = $1')) {
          results = results.filter((s) => s.user_id === params[0]);
        } else if (upper.includes("STATUS = 'ACTIVE'")) {
          const now = new Date();
          results = results.filter((s) => s.status === 'ACTIVE');
          if (upper.includes('NEXT_CHECKIN_DUE_AT <=') && params[0]) {
            const checkTime = new Date(params[0]);
            results = results.filter((s) => new Date(s.next_checkin_due_at) <= checkTime);
          }
        } else if (upper.includes("STATUS IN ('PENDING_CHECKIN', 'GRACE_PERIOD')")) {
          results = results.filter((s) => s.status === 'PENDING_CHECKIN' || s.status === 'GRACE_PERIOD');
        }
        return { rows: results, rowCount: results.length };
      }

      if (upper.includes('FROM TRUSTED_CONTACTS')) {
        let results = [...this.tables.trusted_contacts];
        if (upper.includes('WHERE SWITCH_ID = $1')) {
          results = results.filter((c) => c.switch_id === params[0]);
        } else if (upper.includes('WHERE ID = $1')) {
          results = results.filter((c) => c.id === params[0]);
        }
        return { rows: results, rowCount: results.length };
      }

      if (upper.includes('FROM CHECKIN_TOKENS')) {
        let results = [...this.tables.checkin_tokens];
        if (upper.includes('TOKEN_HASH = $1')) {
          results = results.filter((t) => t.token_hash === params[0]);
        }
        if (upper.includes('USED_AT IS NULL')) {
          results = results.filter((t) => !t.used_at);
        }
        return { rows: results, rowCount: results.length };
      }

      if (upper.includes('FROM AUDIT_LOGS')) {
        let results = [...this.tables.audit_logs];
        if (upper.includes('WHERE SWITCH_ID = $1')) {
          results = results.filter((l) => l.switch_id === params[0]);
        }
        // sort descending
        results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (upper.includes('LIMIT $1')) {
          results = results.slice(0, params[0]);
        } else if (upper.includes('LIMIT $2')) {
          results = results.slice(0, params[1]);
        }
        return { rows: results, rowCount: results.length };
      }

      return { rows: [], rowCount: 0 };
    }

    // 2. INSERT queries
    if (upper.startsWith('INSERT INTO')) {
      const now = new Date().toISOString();

      if (upper.includes('INTO USERS')) {
        const user = {
          id: this.generateUuid(),
          email: params[0],
          password_hash: params[1],
          api_key: params[2],
          created_at: now,
          updated_at: now,
        };
        this.tables.users.push(user);
        return { rows: [user], rowCount: 1 };
      }

      if (upper.includes('INTO SWITCHES')) {
        const sw = {
          id: this.generateUuid(),
          user_id: params[0],
          name: params[1],
          description: params[2],
          status: 'ACTIVE',
          checkin_interval_seconds: params[3],
          grace_period_seconds: params[4],
          last_checkin_at: now,
          next_checkin_due_at: params[5],
          grace_period_ends_at: null,
          reminder_sent_at: null,
          warning_count: 0,
          encrypted_payload: params[6],
          payload_iv: params[7],
          payload_tag: params[8],
          encryption_algorithm: params[9] || 'AES-256-GCM',
          key_release_mode: params[10] || 'DIRECT_RELEASE',
          encrypted_recovery_key: params[11] || null,
          created_at: now,
          updated_at: now,
        };
        this.tables.switches.push(sw);
        return { rows: [sw], rowCount: 1 };
      }

      if (upper.includes('INTO TRUSTED_CONTACTS')) {
        const contact = {
          id: this.generateUuid(),
          switch_id: params[0],
          name: params[1],
          email: params[2],
          relationship: params[3] || 'Trusted Contact',
          custom_message: params[4] || '',
          contact_key_share: params[5] || null,
          notification_status: 'PENDING',
          dispatched_at: null,
          created_at: now,
        };
        this.tables.trusted_contacts.push(contact);
        return { rows: [contact], rowCount: 1 };
      }

      if (upper.includes('INTO CHECKIN_TOKENS')) {
        const token = {
          id: this.generateUuid(),
          switch_id: params[0],
          token_hash: params[1],
          expires_at: params[2],
          used_at: null,
          created_at: now,
        };
        this.tables.checkin_tokens.push(token);
        return { rows: [token], rowCount: 1 };
      }

      if (upper.includes('INTO AUDIT_LOGS')) {
        const log = {
          id: this.generateUuid(),
          switch_id: params[0],
          event_type: params[1],
          severity: params[2] || 'INFO',
          details: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
          ip_address: params[4] || '127.0.0.1',
          created_at: now,
        };
        this.tables.audit_logs.push(log);
        return { rows: [log], rowCount: 1 };
      }
    }

    // 3. UPDATE queries
    if (upper.startsWith('UPDATE')) {
      const now = new Date().toISOString();

      if (upper.includes('UPDATE SWITCHES')) {
        const idMatch = text.match(/WHERE\s+id\s*=\s*\$([0-9]+)/i);
        const idParamIdx = idMatch ? parseInt(idMatch[1], 10) - 1 : params.length - 1;
        const targetId = params[idParamIdx];

        const sw = this.tables.switches.find((s) => s.id === targetId);
        if (sw) {
          if (upper.includes("STATUS = 'TRIGGERED'")) sw.status = 'TRIGGERED';
          else if (upper.includes("STATUS = 'PENDING_CHECKIN'")) sw.status = 'PENDING_CHECKIN';
          else if (upper.includes("STATUS = 'GRACE_PERIOD'")) sw.status = 'GRACE_PERIOD';
          else if (upper.includes("STATUS = 'ACTIVE'")) sw.status = 'ACTIVE';
          else if (upper.includes('STATUS = $1')) sw.status = params[0];
          else if (upper.includes('STATUS = $2')) sw.status = params[1];

          if (upper.includes('LAST_CHECKIN_AT = $1') || upper.includes('LAST_CHECKIN_AT = NOW()')) {
            sw.last_checkin_at = now;
          }
          if (upper.includes('NEXT_CHECKIN_DUE_AT = $1')) sw.next_checkin_due_at = params[0];
          if (upper.includes('NEXT_CHECKIN_DUE_AT = $2')) sw.next_checkin_due_at = params[1];
          if (upper.includes('GRACE_PERIOD_ENDS_AT = NULL')) sw.grace_period_ends_at = null;
          else if (upper.includes('GRACE_PERIOD_ENDS_AT = $1')) sw.grace_period_ends_at = params[0];
          else if (upper.includes('GRACE_PERIOD_ENDS_AT = $2')) sw.grace_period_ends_at = params[1];
          else if (upper.includes('GRACE_PERIOD_ENDS_AT = $3')) sw.grace_period_ends_at = params[2];

          if (upper.includes('REMINDER_SENT_AT = NULL')) sw.reminder_sent_at = null;
          else if (upper.includes('REMINDER_SENT_AT = NOW()')) sw.reminder_sent_at = now;
          else if (upper.includes('REMINDER_SENT_AT = $4')) sw.reminder_sent_at = params[3];

          if (upper.includes('WARNING_COUNT = 0')) sw.warning_count = 0;
          else if (upper.includes('WARNING_COUNT = WARNING_COUNT + 1')) sw.warning_count = (sw.warning_count || 0) + 1;
          
          // Direct field assignment regex
          const setMatches = text.matchAll(/([a-zA-Z_]+)\s*=\s*\$([0-9]+)/g);
          for (const match of setMatches) {
            const col = match[1].toLowerCase();
            const pIdx = parseInt(match[2], 10) - 1;
            if (pIdx < params.length && col !== 'id') {
              sw[col] = params[pIdx];
            }
          }
          sw.updated_at = now;
          return { rows: [sw], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (upper.includes('UPDATE CHECKIN_TOKENS')) {
        const idParam = params[params.length - 1];
        const token = this.tables.checkin_tokens.find((t) => t.id === idParam || t.token_hash === idParam);
        if (token) {
          token.used_at = now;
          return { rows: [token], rowCount: 1 };
        }
      }

      if (upper.includes('UPDATE TRUSTED_CONTACTS')) {
        const targetId = params[params.length - 1];
        const contact = this.tables.trusted_contacts.find((c) => c.id === targetId);
        if (contact) {
          if (upper.includes("NOTIFICATION_STATUS = 'SENT'") || upper.includes('NOTIFICATION_STATUS = $1')) {
            contact.notification_status = params[0] || 'SENT';
          }
          contact.dispatched_at = now;
          return { rows: [contact], rowCount: 1 };
        }
      }
    }

    // 4. DELETE queries
    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('FROM SWITCHES')) {
        const id = params[0];
        const initialLen = this.tables.switches.length;
        this.tables.switches = this.tables.switches.filter((s) => s.id !== id);
        this.tables.trusted_contacts = this.tables.trusted_contacts.filter((c) => c.switch_id !== id);
        this.tables.checkin_tokens = this.tables.checkin_tokens.filter((t) => t.switch_id !== id);
        return { rows: [], rowCount: initialLen - this.tables.switches.length };
      }
      if (upper.includes('FROM TRUSTED_CONTACTS')) {
        const id = params[0];
        const initialLen = this.tables.trusted_contacts.length;
        this.tables.trusted_contacts = this.tables.trusted_contacts.filter((c) => c.id !== id);
        return { rows: [], rowCount: initialLen - this.tables.trusted_contacts.length };
      }
    }

    return { rows: [], rowCount: 0 };
  }
}

let activeDb = null;

export async function initDb() {
  if (activeDb) return activeDb;

  let pool = null;
  try {
    pool = new Pool({
      connectionString: config.db.connectionString,
      connectionTimeoutMillis: 2000,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    });

    // Test PostgreSQL connectivity
    const client = await pool.connect();
    console.log('[DB] Successfully connected to PostgreSQL database.');

    // Execute schema if needed
    const schemaPath = path.resolve(__dirname, '../../schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('[DB] PostgreSQL schema verified/initialized successfully.');
    }
    client.release();

    activeDb = {
      isPostgres: true,
      query: (text, params) => pool.query(text, params),
      pool,
    };
    return activeDb;
  } catch (err) {
    console.warn(`[DB] PostgreSQL server at ${config.db.connectionString} is not reachable (${err.message}).`);
    console.log('[DB] Activating automated local/in-memory database engine for development and testing.');

    const inMem = new InMemoryDatabase();
    activeDb = {
      isPostgres: false,
      query: (text, params) => inMem.query(text, params),
      inMemoryStore: inMem,
    };
    return activeDb;
  }
}

export async function query(text, params = []) {
  if (!activeDb) {
    await initDb();
  }
  return activeDb.query(text, params);
}
