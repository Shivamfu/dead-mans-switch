import cron from 'node-cron';
import { query } from '../db/index.js';
import { getQueues } from './bullmq.service.js';

let cronTask = null;

/**
 * Runs a single evaluation cycle across all switches
 */
export async function runEvaluationCycle() {
  try {
    const now = new Date();
    const queues = getQueues();

    // 1. Scan for ACTIVE switches whose next check-in is due
    const dueSql = `
      SELECT id, name, next_checkin_due_at
      FROM switches
      WHERE status = 'ACTIVE' AND next_checkin_due_at <= $1
    `;
    const dueRes = await query(dueSql, [now.toISOString()]);

    for (const sw of dueRes.rows) {
      console.log(`[Cron] Switch "${sw.name}" (${sw.id}) is due for check-in. Dispatching prompt job.`);
      await queues.checkinQueue.add('send-checkin-prompt', { switchId: sw.id });
    }

    // 2. Scan for switches in grace period that have EXPIRED -> trigger recovery dispatch
    const expiredGraceSql = `
      SELECT id, name, grace_period_ends_at
      FROM switches
      WHERE status IN ('PENDING_CHECKIN', 'GRACE_PERIOD')
        AND grace_period_ends_at IS NOT NULL
        AND grace_period_ends_at <= $1
    `;
    const expiredRes = await query(expiredGraceSql, [now.toISOString()]);

    for (const sw of expiredRes.rows) {
      console.log(`[Cron] Switch "${sw.name}" (${sw.id}) grace period has expired! Enqueueing emergency dispatch.`);
      await queues.dispatchQueue.add('trigger-recovery-dispatch', {
        switchId: sw.id,
        reason: 'GRACE_PERIOD_EXPIRED',
      });
    }

    // 3. Scan for switches in grace period needing escalation warning (warning_count = 0)
    const warningSql = `
      SELECT id, name, reminder_sent_at, grace_period_ends_at, warning_count
      FROM switches
      WHERE status = 'PENDING_CHECKIN'
        AND warning_count = 0
        AND grace_period_ends_at IS NOT NULL
    `;
    const warnRes = await query(warningSql);

    for (const sw of warnRes.rows) {
      const graceEnd = new Date(sw.grace_period_ends_at).getTime();
      const reminderSent = new Date(sw.reminder_sent_at || Date.now()).getTime();
      const totalGraceMs = Math.max(1000, graceEnd - reminderSent);
      const elapsedMs = Date.now() - reminderSent;

      // Send warning if 50% or more of grace period has elapsed
      if (elapsedMs >= totalGraceMs * 0.5) {
        console.log(`[Cron] Switch "${sw.name}" (${sw.id}) is 50%+ into grace period. Enqueueing warning.`);
        await queues.graceQueue.add('send-grace-warning', { switchId: sw.id });
      }
    }
  } catch (err) {
    console.error('[Cron] Error during evaluation cycle:', err.message);
  }
}

/**
 * Initializes the recurring scheduled cron job
 * Runs every minute (* * * * *)
 */
export function initCronScheduler(cronExpression = '* * * * *') {
  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule(cronExpression, async () => {
    console.log(`[Cron] [${new Date().toISOString()}] Running periodic dead man's switch status evaluation...`);
    await runEvaluationCycle();
  });

  console.log(`[Cron] Dead man's switch cron scheduler initialized with pattern: "${cronExpression}"`);
  return cronTask;
}

export function stopCronScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
