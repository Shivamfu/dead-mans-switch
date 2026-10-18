import test from 'node:test';
import assert from 'node:assert/strict';
import { SwitchService } from '../src/services/switch.service.js';
import { initDb, query } from '../src/db/index.js';
import { generateSecureToken, hashToken } from '../src/crypto/tokens.js';

test('Switch Lifecycle: Create, Ping, and Token Verification', async () => {
  await initDb();

  // Create test user
  const userRes = await query(
    `INSERT INTO users (email, password_hash, api_key)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['test-owner@recovery.local', 'hashed_pw', 'dms_test_key_123']
  );
  const userId = userRes.rows[0].id;

  // 1. Create Switch
  const sw = await SwitchService.createSwitch({
    userId,
    name: 'Primary Bitcoin Wallet Keys',
    description: 'Hardware wallet recovery phrases',
    plaintextPayload: '12-word seed phrase: apple banana cherry ...',
    checkinIntervalSeconds: 300, // 5 mins
    gracePeriodSeconds: 60,      // 1 min
    contacts: [
      { name: 'Alice Lawyer', email: 'alice@law.local', customMessage: 'Please execute recovery' },
    ],
  });

  assert.equal(sw.name, 'Primary Bitcoin Wallet Keys');
  assert.equal(sw.status, 'ACTIVE');
  assert.ok(sw.next_checkin_due_at);
  assert.equal(sw.contacts.length, 1);
  assert.equal(sw.contacts[0].email, 'alice@law.local');

  // 2. Ping Check-in
  const initialDue = sw.next_checkin_due_at;
  // Sleep 10ms to ensure timestamp difference
  await new Promise((r) => setTimeout(r, 20));

  const updatedSw = await SwitchService.processCheckin(sw.id, 'API_TEST_PING');
  assert.equal(updatedSw.status, 'ACTIVE');
  assert.ok(new Date(updatedSw.next_checkin_due_at).getTime() >= new Date(initialDue).getTime());

  // 3. Single-use token check-in
  const rawToken = generateSecureToken();
  const tokenHashStr = hashToken(rawToken);
  await query(
    `INSERT INTO checkin_tokens (switch_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [sw.id, tokenHashStr, new Date(Date.now() + 60000).toISOString()]
  );

  const tokenSw = await SwitchService.verifyTokenAndCheckin(rawToken);
  assert.equal(tokenSw.id, sw.id);

  // Attempting to reuse the same token must fail
  await assert.rejects(
    async () => {
      await SwitchService.verifyTokenAndCheckin(rawToken);
    },
    /Check-in token is invalid, expired, or has already been used/
  );
});

test('Switch Trigger & State Immutability', async () => {
  await initDb();

  const userRes = await query(
    `INSERT INTO users (email, password_hash, api_key)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['test-victim@recovery.local', 'hashed_pw', 'dms_test_key_456']
  );
  const userId = userRes.rows[0].id;

  const sw = await SwitchService.createSwitch({
    userId,
    name: 'Server Root Passwords',
    plaintextPayload: 'root:P@ssword9876!',
    checkinIntervalSeconds: 60,
    gracePeriodSeconds: 30,
    contacts: [{ name: 'Bob Sysadmin', email: 'bob@sysadmin.local' }],
  });

  // Manually trigger switch
  const dispatchResult = await SwitchService.triggerDispatch(sw.id, 'MANUAL_TEST');
  assert.equal(dispatchResult.status, 'TRIGGERED');
  assert.equal(dispatchResult.dispatchedCount, 1);

  // Verifying that an already triggered switch cannot be reset by a ping
  await assert.rejects(
    async () => {
      await SwitchService.processCheckin(sw.id, 'LATE_PING');
    },
    /Switch has already been triggered and dispatched/
  );
});
