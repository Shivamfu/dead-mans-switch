import { Worker } from 'bullmq';
import { getRedisStatus } from './connection.js';
import { getQueues } from './bullmq.service.js';
import { SwitchService } from '../services/switch.service.js';

let checkinWorker = null;
let graceWorker = null;
let dispatchWorker = null;

export async function initWorkers() {
  const { isRedisAvailable, redisClient } = getRedisStatus();
  const queues = getQueues();

  // Process handler logic
  const handleCheckinJob = async (job) => {
    const { switchId } = job.data;
    console.log(`[Worker] Processing check-in prompt for switch: ${switchId}`);
    await SwitchService.sendCheckinPrompt(switchId);
  };

  const handleGraceJob = async (job) => {
    const { switchId } = job.data;
    console.log(`[Worker] Processing grace warning for switch: ${switchId}`);
    await SwitchService.sendGraceWarning(switchId);
  };

  const handleDispatchJob = async (job) => {
    const { switchId, reason } = job.data;
    console.log(`[Worker] Processing emergency recovery dispatch for switch: ${switchId} (Reason: ${reason})`);
    await SwitchService.triggerDispatch(switchId, reason || 'GRACE_PERIOD_EXPIRED');
  };

  if (isRedisAvailable && redisClient) {
    checkinWorker = new Worker('checkin-prompt-queue', handleCheckinJob, {
      connection: redisClient,
      concurrency: 5,
    });
    graceWorker = new Worker('grace-warning-queue', handleGraceJob, {
      connection: redisClient,
      concurrency: 5,
    });
    dispatchWorker = new Worker('switch-dispatch-queue', handleDispatchJob, {
      connection: redisClient,
      concurrency: 5,
    });

    checkinWorker.on('failed', (job, err) => console.error(`[BullMQ Worker:Checkin] Job ${job?.id} failed:`, err.message));
    graceWorker.on('failed', (job, err) => console.error(`[BullMQ Worker:Grace] Job ${job?.id} failed:`, err.message));
    dispatchWorker.on('failed', (job, err) => console.error(`[BullMQ Worker:Dispatch] Job ${job?.id} failed:`, err.message));

    console.log('[BullMQ] Redis BullMQ workers listening for jobs.');
  } else {
    // Register in-memory handlers
    queues.checkinQueue.process(handleCheckinJob);
    queues.graceQueue.process(handleGraceJob);
    queues.dispatchQueue.process(handleDispatchJob);
    console.log('[Workers] In-process queue handlers registered successfully.');
  }
}
