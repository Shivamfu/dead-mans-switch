import { Queue } from 'bullmq';
import { getRedisStatus } from './connection.js';

// In-process resilient queue runner for local development without Redis daemon
class InMemoryJobQueue {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.jobs = [];
  }

  process(handler) {
    this.handlers.push(handler);
  }

  async add(jobName, data = {}, opts = {}) {
    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: jobName,
      data,
      opts,
      timestamp: Date.now(),
    };

    if (opts.delay && opts.delay > 0) {
      setTimeout(async () => {
        for (const h of this.handlers) {
          try {
            await h(job);
          } catch (e) {
            console.error(`[InMemQueue:${this.name}] Job error:`, e.message);
          }
        }
      }, opts.delay);
    } else {
      setImmediate(async () => {
        for (const h of this.handlers) {
          try {
            await h(job);
          } catch (e) {
            console.error(`[InMemQueue:${this.name}] Job error:`, e.message);
          }
        }
      });
    }

    return job;
  }
}

let checkinQueueInstance = null;
let graceQueueInstance = null;
let dispatchQueueInstance = null;

export function getQueues() {
  const { isRedisAvailable, redisClient } = getRedisStatus();

  if (isRedisAvailable && redisClient) {
    if (!checkinQueueInstance || checkinQueueInstance instanceof InMemoryJobQueue) {
      checkinQueueInstance = new Queue('checkin-prompt-queue', { connection: redisClient });
      graceQueueInstance = new Queue('grace-warning-queue', { connection: redisClient });
      dispatchQueueInstance = new Queue('switch-dispatch-queue', { connection: redisClient });
      console.log('[BullMQ] Initialized Redis-backed BullMQ queues.');
    }
  } else {
    if (!checkinQueueInstance || !(checkinQueueInstance instanceof InMemoryJobQueue)) {
      checkinQueueInstance = new InMemoryJobQueue('checkin-prompt-queue');
      graceQueueInstance = new InMemoryJobQueue('grace-warning-queue');
      dispatchQueueInstance = new InMemoryJobQueue('switch-dispatch-queue');
      console.log('[BullMQ] Initialized In-Memory fallback queues.');
    }
  }

  return {
    checkinQueue: checkinQueueInstance,
    graceQueue: graceQueueInstance,
    dispatchQueue: dispatchQueueInstance,
  };
}
