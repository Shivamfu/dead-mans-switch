import Redis from 'ioredis';
import { config } from '../config.js';

let redisClient = null;
let isRedisAvailable = false;

export async function initRedis() {
  if (redisClient) return { redisClient, isRedisAvailable };

  try {
    const client = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 2) return null; // stop trying after 2 attempts
        return Math.min(times * 100, 1000);
      },
    });

    client.on('error', (err) => {
      // Suppress unhandled event logs if offline
    });

    await client.connect();
    console.log('[Redis] Connected to Redis instance successfully.');
    redisClient = client;
    isRedisAvailable = true;
    return { redisClient, isRedisAvailable };
  } catch (err) {
    console.warn(`[Redis] Redis at ${config.redis.url} is not reachable (${err.message}).`);
    console.log('[Redis] Operating in resilient in-process queue mode for local development/testing.');
    isRedisAvailable = false;
    return { redisClient: null, isRedisAvailable: false };
  }
}

export function getRedisStatus() {
  return { isRedisAvailable, redisClient };
}
