import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, query } from '../src/db/index.js';
import { initRedis } from '../src/queues/connection.js';
import { initWorkers } from '../src/queues/workers.js';
import { getQueues } from '../src/queues/bullmq.service.js';
import { runEvaluationCycle } from '../src/queues/cron.js';
import { SwitchService } from '../src/services/switch.service.js';
import { emailService } from '../src/services/email.service.js';

test('Queue Workers & BullMQ Job Processing', async () => {
  await initDb();
  await initRedis();
  await initWorkers();

  // Create test owner
  const userRes = await query(
    `INSERT INTO users (email, password_hash, api_key)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['queue-owner@vault.local', 'pw', 'dms_queue_123']
  );
  const userId = userRes.rows[0].id;

  const sw = await SwitchService.createSwitch({
    userId,
    name: 'Cloud Infrastructure Keys',
    plaintextPayload: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    checkinIntervalSeconds: 60,
    gracePeriodSeconds: 30,
    contacts: [{ name: 'DevOps Lead', email: 'devops@company.local' }],
  });

  const queues = getQueues();

  // 1. Enqueue check-in prompt job
  await queues.checkinQueue.add('send-checkin-prompt', { switchId: sw.id });
  // Allow worker loop a brief moment to process
  await new Promise((r) => setTimeout(r, 60));

  const afterPromptSw = await SwitchService.getSwitchById(sw.id);
  assert.equal(afterPromptSw.status, 'PENDING_CHECKIN');
  assert.ok(afterPromptSw.grace_period_ends_at);

  // 2. Enqueue emergency recovery dispatch job
  await queues.dispatchQueue.add('trigger-recovery-dispatch', {
    switchId: sw.id,
    reason: 'TEST_MANUAL_DISPATCH',
  });
  await new Promise((r) => setTimeout(r, 60));

  const afterDispatchSw = await SwitchService.getSwitchById(sw.id);
  assert.equal(afterDispatchSw.status, 'TRIGGERED');

  // Verify email was generated and captured in recent emails
  const recentMails = emailService.getRecentEmails();
  const dispatchedMail = recentMails.find((m) => m.to === 'devops@company.local');
  assert.ok(dispatchedMail, 'Recovery email must be sent to contact');
  assert.ok(dispatchedMail.text.includes('AWS_SECRET_ACCESS_KEY'), 'Payload must be unsealed in email');
});

test('Cron Evaluation Cycle: Due date detection and Grace Period trigger', async () => {
  await initDb();
  await initRedis();
  await initWorkers();

  const userRes = await query(
    `INSERT INTO users (email, password_hash, api_key)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['cron-user@vault.local', 'pw', 'dms_cron_456']
  );
  const userId = userRes.rows[0].id;

  // Create a switch whose due date is already in the past
  const pastDate = new Date(Date.now() - 10000).toISOString();
  const sw = await SwitchService.createSwitch({
    userId,
    name: 'Database Master Encryption Passphrase',
    plaintextPayload: 'ENC_KEY_8829103984',
    checkinIntervalSeconds: 60,
    gracePeriodSeconds: 30,
    contacts: [{ name: 'Trusted Partner', email: 'partner@vault.local' }],
  });

  // Fast-forward next_checkin_due_at to the past
  await query(
    `UPDATE switches SET next_checkin_due_at = $1 WHERE id = $2`,
    [pastDate, sw.id]
  );

  // Run evaluation cycle (simulating cron tick)
  await runEvaluationCycle();
  await new Promise((r) => setTimeout(r, 60));

  const evaluatedSw = await SwitchService.getSwitchById(sw.id);
  assert.equal(evaluatedSw.status, 'PENDING_CHECKIN');

  // Now simulate expired grace period
  await query(
    `UPDATE switches SET grace_period_ends_at = $1 WHERE id = $2`,
    [pastDate, sw.id]
  );

  await runEvaluationCycle();
  await new Promise((r) => setTimeout(r, 60));

  const triggeredSw = await SwitchService.getSwitchById(sw.id);
  assert.equal(triggeredSw.status, 'TRIGGERED');
});
