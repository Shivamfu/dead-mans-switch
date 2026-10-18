import { createApp } from './src/app.js';
import { config } from './src/config.js';
import { initDb } from './src/db/index.js';
import { initRedis } from './src/queues/connection.js';
import { initWorkers } from './src/queues/workers.js';
import { initCronScheduler, stopCronScheduler } from './src/queues/cron.js';
import { emailService } from './src/services/email.service.js';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('  🛡️  AEGIS RECOVERY SERVICE - DEAD MAN\'S SWITCH');
  console.log('----------------------------------------------------');

  // 1. Initialize Database (PostgreSQL / In-Memory Fallback)
  await initDb();

  // 2. Initialize Redis & BullMQ Queue connection
  await initRedis();

  // 3. Initialize Email Dispatcher (Nodemailer / Resend)
  await emailService.init();

  // 4. Initialize Queue Workers
  await initWorkers();

  // 5. Initialize Periodic Cron Scheduler (evaluates switch deadlines)
  initCronScheduler('* * * * *');

  // 6. Start Express Web Server
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[Server] Live on ${config.appUrl}`);
    console.log(`[Server] Web Dashboard: ${config.appUrl}`);
    console.log(`[Server] Health Check:  ${config.appUrl}/api/health`);
    console.log('----------------------------------------------------');
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    console.log('\n[Server] Shutting down gracefully...');
    stopCronScheduler();
    server.close(() => {
      console.log('[Server] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap Error]', err);
  process.exit(1);
});
