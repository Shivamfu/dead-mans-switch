import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRouter from './routes/auth.routes.js';
import switchRouter from './routes/switch.routes.js';
import checkinRouter from './routes/checkin.routes.js';
import contactsRouter from './routes/contacts.routes.js';
import auditRouter from './routes/audit.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Static Dashboard Assets
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'Aegis Dead Man\'s Switch Recovery Service',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API & Webhook Routes
  app.use('/api/auth', authRouter);
  app.use('/api/switches', switchRouter);
  app.use('/api/switches', contactsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/', checkinRouter); // includes /api/checkin/:id/ping and /checkin/:token

  // Error handling middleware
  app.use(errorHandler);

  return app;
}
