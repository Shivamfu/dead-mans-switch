# 🛡️ Aegis: Automated Dead Man's Switch & Credential Recovery Vault

An enterprise-grade, zero-compromise automated recovery service that securely stores and unseals encrypted credentials, secrets, or emergency recovery notes to designated trusted contacts if the vault owner becomes inactive.

> 🔒 **Local Security Note**: Stored exclusively on your local machine. No external repositories or GitHub remotes configured.

---

## 🌟 Core Mechanisms

1. **Scheduled Periodic Heartbeat Prompts**:
   - A configurable cron job or BullMQ delayed job evaluates active recovery switches (e.g., every 30 days, 7 days, or minutes for testing).
   - When a check-in is due, the service generates a cryptographically secure, single-use check-in token and notifies the owner via **Nodemailer / Resend** with a 1-click authenticated confirmation link and a headless cURL ping command.

2. **Emergency Grace Period**:
   - If a scheduled check-in is missed, the vault transitions into `PENDING_CHECKIN` and enters an emergency `GRACE_PERIOD` countdown.
   - Escalation warnings are dispatched to the owner's email with high urgency.

3. **Irrevocable Automatic Dispatch**:
   - If the grace period expires without an authenticated heartbeat, the switch transitions to `TRIGGERED`.
   - The encrypted payload is unsealed using AES-256-GCM envelope keys and automatically dispatched to each designated trusted contact with personalized notes and recovery instructions.

4. **Heartbeat Reset**:
   - An authenticated ping (via web link, JWT, or dedicated API key) resets the timer, updates `last_checkin_at`, extends `next_checkin_due_at`, clears warnings, and returns the switch to `ACTIVE`.

---

## 🏗️ Tech Stack

- **Runtime & Backend**: Node.js (ES Modules, Express 4.x)
- **Job Queues & Scheduling**: Redis + **BullMQ** (`checkin-prompt-queue`, `grace-warning-queue`, `switch-dispatch-queue`) with cron scheduler (`node-cron`) and automatic in-process fallback runner.
- **Database**: **PostgreSQL** (`pg` connection pool with relational schema, UUIDs, foreign keys, and indexes) + automatic local storage driver for development.
- **Email Dispatching**: Dual-mode engine supporting **Nodemailer** (SMTP, Ethereal test accounts) and **Resend** official SDK (`resend`), plus an in-memory live inbox inspector in the Web UI.
- **Cryptography**: Node.js `node:crypto` — **AES-256-GCM** authenticated symmetric encryption (96-bit IV, 128-bit authentication tag), **Scrypt** key derivation, and **HMAC-SHA256** constant-time token verification.

---

## 🔐 Cryptographic Architecture

```
[Plaintext Payload]
        │
        ▼
   (AES-256-GCM) ◄─── Unique Data Encryption Key (DEK)
        │
        ├────────────────────────┬─────────────────────────┐
        ▼                        ▼                         ▼
 [Ciphertext Hex]            [IV 12B]                 [Auth Tag 16B]
                                                           │
                                                           ▼
                                               [Tamper-Proof Guarantee]

Unique DEK ──► Encrypted via KEK derived from Master Password/Salt ──► Stored in Vault
```

- **Authenticated Encryption**: Any alteration or bit-flip in ciphertext or IV causes an immediate authentication tag mismatch error, preventing forged secret injections.
- **Zero-Plaintext Server State**: Payloads are stored encrypted in the database at rest and are unsealed only at the moment of verified trigger dispatch.
- **Single-Use Check-in Tokens**: Links sent in emails contain cryptographically random 256-bit entropy tokens, hashed via SHA-256 before database lookup to protect against token leakage.

---

## 📊 State Machine

```
              ┌───────────────────────────────┐
              │            ACTIVE             │◄────────┐
              └──────────────┬────────────────┘         │
                             │                          │
                 (next_checkin_due_at)                  │ (Authenticated
                             │                          │  Heartbeat Ping)
                             ▼                          │
              ┌───────────────────────────────┐         │
              │       PENDING_CHECKIN         │─────────┤
              └──────────────┬────────────────┘         │
                             │                          │
                 (grace period begins)                  │
                             ▼                          │
              ┌───────────────────────────────┐         │
              │         GRACE_PERIOD          │─────────┘
              └──────────────┬────────────────┘
                             │
                 (grace_period_ends_at)
                             │
                             ▼
              ┌───────────────────────────────┐
              │          TRIGGERED            │
              └──────────────┬────────────────┘
                             │
                             ▼
             [Unseal AES-256-GCM Payload]
                             │
                             ▼
             [Dispatch to Trusted Contacts]
```

---

## 🚀 Quick Start Guide

### 1. Installation

```bash
cd "C:\Users\Lenovo\.gemini\antigravity\scratch\dead-mans-switch"
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```env
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000

# Security
JWT_SECRET=your_super_secret_jwt_key
SYSTEM_MASTER_SALT=your_secure_master_salt

# PostgreSQL Database (Native PG connection string)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deadmansswitch

# Redis & BullMQ
REDIS_URL=redis://127.0.0.1:6379

# Email Provider: 'console' (local preview), 'ethereal' (test inbox), 'nodemailer' (SMTP), 'resend' (Resend API)
EMAIL_PROVIDER=console
EMAIL_FROM=Dead Man's Switch Vault <noreply@vault.local>

# Optional Resend API Key
RESEND_API_KEY=

# Optional SMTP Settings
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

### 3. Run the Service

```bash
npm start
```

Visit the Web Dashboard at: **`http://localhost:3000`**

### 4. Run the Test Suite

```bash
# Run all tests (Crypto, Switch lifecycle, Queue workers, End-to-End integration)
npm test

# Run individual test files
npm run test:crypto
npm run test:switch
npm run test:e2e
```

---

## 📡 API Reference

### 1. Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new user account; returns JWT and API Key |
| `POST` | `/api/auth/login` | Log in with email and password |
| `GET` | `/api/auth/me` | Get current user profile and ping API key |

### 2. Dead Man's Switch Management

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/switches` | Create switch with AES-256 encrypted payload and contacts |
| `GET` | `/api/switches` | List all switches for authenticated user |
| `GET` | `/api/switches/:id` | Get details, contacts, and audit logs of a switch |
| `DELETE` | `/api/switches/:id` | Permanently delete a switch |
| `POST` | `/api/switches/:id/emergency-trigger` | Manually unseal and dispatch credentials immediately |
| `POST` | `/api/switches/:id/simulate-due` | Fast-forward due date for rapid testing |

### 3. Check-in & Heartbeat

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/checkin/:id/ping` | Send authenticated heartbeat via JWT or `X-API-Key` |
| `GET` | `/checkin/:token` | 1-Click web link from email prompt to confirm status |

#### Example cURL Ping (Headless Script / Cron):
```bash
curl -X POST http://localhost:3000/api/checkin/<SWITCH_ID>/ping \
  -H "Authorization: Bearer dms_your_api_key_here"
```

### 4. Audit & Email Inspection

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/audit/logs` | Retrieve recent security audit trail |
| `GET` | `/api/audit/recent-emails` | Live feed of dispatched emails (with credentials and tokens) |
| `POST` | `/api/audit/evaluate-now` | Force immediate cron evaluation cycle |

---

## 🧪 Verified Automated Test Suite

- **`tests/crypto.test.js`**: Verifies AES-256-GCM authenticated encryption, tamper detection, envelope key derivation, and HMAC token signing.
- **`tests/switch.test.js`**: Verifies switch creation, check-in reset mechanisms, token invalidation, and state immutability.
- **`tests/queues.test.js`**: Verifies BullMQ queue workers, job dispatching, and cron deadline evaluation.
- **`tests/integration.test.js`**: Verifies full end-to-end user lifecycle: registration -> switch creation -> API key ping -> due simulation -> 1-click email confirmation -> emergency trigger -> unsealed credential dispatch to trusted contacts.

All 9 test suites pass with **100% success rate**.
