import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { initRedis } from '../src/queues/connection.js';
import { initWorkers } from '../src/queues/workers.js';
import { emailService } from '../src/services/email.service.js';

let server;
let baseUrl;

test.before(async () => {
  await initDb();
  await initRedis();
  await emailService.init();
  await initWorkers();

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('End-to-End System Integration Flow', async () => {
  // 1. Register User
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `e2e_owner_${Date.now()}@vault.local`,
      password: 'StrongMasterPassword2026!',
    }),
  });
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  const token = regData.token;
  const apiKey = regData.user.apiKey;
  assert.ok(token);
  assert.ok(apiKey.startsWith('dms_'));

  // 2. Verify Profile Authentication
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);

  // 3. Create Dead Man's Switch Vault
  const secretCreds = 'DATABASE_MASTER_URL=postgresql://admin:TopSecret@db.prod.internal:5432/main';
  const createRes = await fetch(`${baseUrl}/api/switches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Production DB & Infrastructure Keys',
      description: 'Emergency recovery notes for engineering team',
      payload: secretCreds,
      checkinIntervalSeconds: 120, // 2 mins
      gracePeriodSeconds: 60,      // 1 min
      contacts: [
        {
          name: 'Sarah CTO',
          email: 'sarah.cto@startup.local',
          customMessage: 'Here are the production database credentials.',
        },
      ],
    }),
  });
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  const switchId = createData.switch.id;
  assert.ok(switchId);
  assert.equal(createData.switch.status, 'ACTIVE');

  // 4. Authenticated Heartbeat Ping using API Key (like curl / cron)
  const pingRes = await fetch(`${baseUrl}/api/checkin/${switchId}/ping`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert.equal(pingRes.status, 200);
  const pingData = await pingRes.json();
  assert.equal(pingData.switch.status, 'ACTIVE');

  // 5. Fast-Forward Due Date (Simulate Check-in Due)
  const simDueRes = await fetch(`${baseUrl}/api/switches/${switchId}/simulate-due`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(simDueRes.status, 200);

  // 6. Trigger Cron Evaluation Tick
  const evalRes = await fetch(`${baseUrl}/api/audit/evaluate-now`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(evalRes.status, 200);

  // Wait for worker job to fire prompt email
  await new Promise((r) => setTimeout(r, 60));

  // 7. Check Recent Outgoing Emails for Check-in Prompt
  const mailsRes = await fetch(`${baseUrl}/api/audit/recent-emails`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mailsData = await mailsRes.json();
  const promptMail = mailsData.emails.find((m) => m.subject.includes('Check-in: Production DB'));
  assert.ok(promptMail, 'Check-in prompt email must be dispatched');
  assert.ok(promptMail.text.includes('/checkin/'), 'Must contain 1-click check-in link');

  // Extract the token URL
  const tokenMatch = promptMail.text.match(/\/checkin\/([a-f0-9]+)/);
  assert.ok(tokenMatch, 'Check-in token must be present in email');
  const extractedToken = tokenMatch[1];

  // 8. User clicks 1-Click Link from Email (GET /checkin/:token)
  const linkRes = await fetch(`${baseUrl}/checkin/${extractedToken}`);
  assert.equal(linkRes.status, 200);
  const linkHtml = await linkRes.text();
  assert.ok(linkHtml.includes('Check-in Confirmed'), 'Webpage must confirm check-in');

  // 9. Execute Emergency Recovery Trigger (Unsealing & Dispatch)
  const trigRes = await fetch(`${baseUrl}/api/switches/${switchId}/emergency-trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(trigRes.status, 200);
  const trigData = await trigRes.json();
  assert.equal(trigData.result.status, 'TRIGGERED');
  assert.equal(trigData.result.dispatchedCount, 1);

  // 10. Verify Contact Received Unsealed Secret Credentials
  const finalMailsRes = await fetch(`${baseUrl}/api/audit/recent-emails`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const finalMails = await finalMailsRes.json();
  const recoveryMail = finalMails.emails.find((m) => m.to === 'sarah.cto@startup.local');
  assert.ok(recoveryMail, 'Recovery package must be emailed to Sarah CTO');
  assert.ok(recoveryMail.text.includes('DATABASE_MASTER_URL'), 'Plaintext credentials must be unsealed and delivered');
  assert.ok(recoveryMail.text.includes('Sarah CTO'), 'Recipient name should be personalized');

  // 11. Verify Immutable Security Audit Log
  const auditRes = await fetch(`${baseUrl}/api/audit/logs?switchId=${switchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const auditData = await auditRes.json();
  const eventTypes = auditData.logs.map((l) => l.event_type);
  assert.ok(eventTypes.includes('SWITCH_CREATED'));
  assert.ok(eventTypes.includes('CHECKIN_PING_RECEIVED'));
  assert.ok(eventTypes.includes('SWITCH_TRIGGERED'));
  assert.ok(eventTypes.includes('PAYLOAD_DISPATCHED'));
});
