import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3500,
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3500}`,
  
  jwtSecret: process.env.JWT_SECRET || 'memento_vault_jwt_secret_dev_3821098471092834',
  systemMasterSalt: process.env.SYSTEM_MASTER_SALT || 'dead_mans_switch_kdf_salt_5510294875928',
  
  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/deadmansswitch',
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
  
  email: {
    provider: process.env.EMAIL_PROVIDER || 'console', // 'console', 'ethereal', 'nodemailer', 'resend'
    from: process.env.EMAIL_FROM || 'Dead Man\'s Switch Vault <noreply@vault.local>',
    resendApiKey: process.env.RESEND_API_KEY || '',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    },
  },
  
  defaults: {
    checkinIntervalSeconds: parseInt(process.env.DEFAULT_CHECKIN_INTERVAL, 10) || 2592000, // 30 days
    gracePeriodSeconds: parseInt(process.env.DEFAULT_GRACE_PERIOD, 10) || 604800,          // 7 days
  },
};
