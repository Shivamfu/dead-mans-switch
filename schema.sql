-- Dead Man's Switch PostgreSQL Schema
-- Automated Recovery & Encrypted Credential Dispatch System

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Switches (Recovery Vault Items)
CREATE TABLE IF NOT EXISTS switches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PENDING_CHECKIN, GRACE_PERIOD, TRIGGERED, PAUSED
    checkin_interval_seconds INTEGER NOT NULL DEFAULT 2592000, -- 30 days default
    grace_period_seconds INTEGER NOT NULL DEFAULT 604800, -- 7 days default
    last_checkin_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    next_checkin_due_at TIMESTAMPTZ NOT NULL,
    grace_period_ends_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    warning_count INTEGER DEFAULT 0,
    encrypted_payload TEXT NOT NULL,
    payload_iv VARCHAR(64) NOT NULL,
    payload_tag VARCHAR(64) NOT NULL,
    encryption_algorithm VARCHAR(50) DEFAULT 'AES-256-GCM',
    key_release_mode VARCHAR(50) DEFAULT 'DIRECT_RELEASE',
    encrypted_recovery_key TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Trusted Contacts designated to receive recovery credentials
CREATE TABLE IF NOT EXISTS trusted_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    switch_id UUID NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    relationship VARCHAR(100),
    custom_message TEXT,
    contact_key_share TEXT,
    notification_status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, SENT, FAILED
    dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Single-use Check-in Tokens (for 1-click email pings)
CREATE TABLE IF NOT EXISTS checkin_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    switch_id UUID NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Immutable Security & Operational Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    switch_id UUID REFERENCES switches(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO',
    details JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_switches_status_due ON switches(status, next_checkin_due_at);
CREATE INDEX IF NOT EXISTS idx_switches_grace ON switches(status, grace_period_ends_at);
CREATE INDEX IF NOT EXISTS idx_switches_user ON switches(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_switch ON trusted_contacts(switch_id);
CREATE INDEX IF NOT EXISTS idx_checkin_tokens ON checkin_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_switch ON audit_logs(switch_id, created_at DESC);
