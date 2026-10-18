import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { config } from '../config.js';

class EmailService {
  constructor() {
    this.provider = config.email.provider;
    this.from = config.email.from;
    this.resendClient = config.email.resendApiKey ? new Resend(config.email.resendApiKey) : null;
    this.transporter = null;
    this.recentEmails = []; // Live in-memory inbox for UI preview and test inspection
  }

  async init() {
    if (this.provider === 'nodemailer') {
      this.transporter = nodemailer.createTransport(config.email.smtp);
      console.log(`[Email] Initialized Nodemailer with host ${config.email.smtp.host}`);
    } else if (this.provider === 'ethereal') {
      const testAccount = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log(`[Email] Initialized Ethereal test account: ${testAccount.user}`);
    } else if (this.provider === 'resend') {
      if (!this.resendClient) {
        console.warn('[Email] Resend API key missing. Falling back to console output mode.');
        this.provider = 'console';
      } else {
        console.log('[Email] Initialized Resend email dispatcher.');
      }
    } else {
      console.log('[Email] Initialized Console/Local email dispatcher (emails will be logged and captured for web UI).');
    }
  }

  recordEmail(emailData) {
    const record = {
      id: `mail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...emailData,
    };
    this.recentEmails.unshift(record);
    if (this.recentEmails.length > 50) {
      this.recentEmails.pop();
    }
    return record;
  }

  getRecentEmails() {
    return [...this.recentEmails];
  }

  async send({ to, subject, html, text }) {
    const mailRecord = this.recordEmail({ to, subject, html, text });

    if (this.provider === 'resend' && this.resendClient) {
      try {
        const response = await this.resendClient.emails.send({
          from: this.from,
          to,
          subject,
          html,
          text,
        });
        console.log(`[Email:Resend] Dispatched email to ${to}: ${subject} (ID: ${response.data?.id})`);
        return { success: true, messageId: response.data?.id, record: mailRecord };
      } catch (err) {
        console.error(`[Email:Resend] Failed to send email to ${to}:`, err.message);
        return { success: false, error: err.message, record: mailRecord };
      }
    }

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
          text,
        });
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log(`[Email:Ethereal] Preview available: ${previewUrl}`);
          mailRecord.previewUrl = previewUrl;
        }
        console.log(`[Email:Nodemailer] Dispatched email to ${to}: ${subject} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId, previewUrl, record: mailRecord };
      } catch (err) {
        console.error(`[Email:Nodemailer] Failed to send email to ${to}:`, err.message);
        return { success: false, error: err.message, record: mailRecord };
      }
    }

    // Default console output provider
    console.log('\n================== [OUTGOING EMAIL NOTIFICATION] ==================');
    console.log(`To:      ${to}`);
    console.log(`From:    ${this.from}`);
    console.log(`Subject: ${subject}`);
    console.log(`Date:    ${new Date().toISOString()}`);
    console.log('------------------------- TEXT CONTENT ----------------------------');
    console.log(text);
    console.log('===================================================================\n');

    return { success: true, messageId: mailRecord.id, record: mailRecord };
  }

  // --- Specialized Email Templates ---

  /**
   * Prompts the vault owner to verify they are alive and active
   */
  async sendCheckinPrompt({ to, switchName, switchId, checkinUrl, dueDate, gracePeriodHours }) {
    const subject = `[ACTION REQUIRED] Dead Man's Switch Check-in: ${switchName}`;
    const text = `
Hello,

This is your automated Dead Man's Switch verification for: "${switchName}".
Your check-in deadline is: ${new Date(dueDate).toUTCString()}.

If you do not check in, your vault will enter an emergency GRACE PERIOD of ${gracePeriodHours} hours.
After the grace period expires, your encrypted credentials will be permanently dispatched to your designated trusted contacts.

👉 To confirm you are active and reset the switch timer, click the link below:
${checkinUrl}

Or execute this authenticated cURL command from your terminal:
curl -X POST ${config.appUrl}/api/checkin/${switchId}/ping -H "Authorization: Bearer <YOUR_API_KEY>"

If you are alive and well, please complete this check-in immediately.
`;

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #1e293b;">
  <div style="display: flex; align-items: center; margin-bottom: 24px;">
    <div style="width: 14px; height: 14px; background: #38bdf8; border-radius: 50%; display: inline-block; margin-right: 10px;"></div>
    <span style="font-size: 14px; font-weight: 700; letter-spacing: 0.1em; color: #38bdf8; text-transform: uppercase;">Aegis Recovery System</span>
  </div>
  <h2 style="margin: 0 0 16px 0; color: #ffffff; font-size: 22px;">Scheduled Check-in Required</h2>
  <p style="color: #94a3b8; font-size: 15px; line-height: 1.6;">
    Your automated recovery vault item <strong style="color: #f1f5f9;">"${switchName}"</strong> requires your periodic check-in.
  </p>
  
  <div style="background: #1e293b; border-left: 4px solid #38bdf8; padding: 16px; border-radius: 6px; margin: 24px 0;">
    <div style="font-size: 13px; color: #94a3b8;">Check-in Due Date:</div>
    <div style="font-size: 16px; font-weight: 600; color: #38bdf8;">${new Date(dueDate).toLocaleString()}</div>
    <div style="font-size: 13px; color: #ef4444; margin-top: 8px;">
      ⚠️ Grace period if missed: <strong>${gracePeriodHours} hours</strong> before automatic payload dispatch.
    </div>
  </div>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${checkinUrl}" style="background: #0284c7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);">
      ✅ Confirm Active (1-Click Ping)
    </a>
  </div>

  <div style="background: #090d16; padding: 14px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #64748b; word-break: break-all;">
    API Link: <a href="${checkinUrl}" style="color: #38bdf8;">${checkinUrl}</a>
  </div>
</div>
`;

    return this.send({ to, subject, html, text });
  }

  /**
   * Urgent alert when check-in was missed and switch is in grace period
   */
  async sendGracePeriodWarning({ to, switchName, switchId, checkinUrl, graceEndsAt, remainingHours }) {
    const subject = `🚨 [URGENT WARNING] Dead Man's Switch Grace Period Active: ${switchName}`;
    const text = `
URGENT ALERT:

Your Dead Man's Switch for "${switchName}" has entered its emergency GRACE PERIOD because your scheduled check-in was not received.

Time Remaining: ${remainingHours} hours (Expires: ${new Date(graceEndsAt).toUTCString()}).

WHEN THE TIMER REACHES ZERO:
All designated credentials, recovery notes, and decryption keys will be automatically sent to your designated trusted contacts.

👉 TO CANCEL THIS COUNTDOWN AND RESTORE NORMAL STATUS, PING IMMEDIATELY:
${checkinUrl}
`;

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1c1012; color: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #7f1d1d;">
  <div style="display: flex; align-items: center; margin-bottom: 24px;">
    <span style="font-size: 14px; font-weight: 700; letter-spacing: 0.1em; color: #ef4444; text-transform: uppercase;">⚠️ Emergency Countdown Active</span>
  </div>
  <h2 style="margin: 0 0 16px 0; color: #fca5a5; font-size: 24px;">Grace Period Expiring Soon</h2>
  <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
    Your scheduled check-in for <strong style="color: #ffffff;">"${switchName}"</strong> was missed.
  </p>

  <div style="background: #450a0a; border: 1px solid #dc2626; padding: 20px; border-radius: 8px; margin: 24px 0; text-align: center;">
    <div style="font-size: 13px; text-transform: uppercase; color: #fca5a5; letter-spacing: 0.05em;">Time Before Automatic Release</div>
    <div style="font-size: 32px; font-weight: 800; color: #ef4444; margin: 8px 0;">${remainingHours} Hours Remaining</div>
    <div style="font-size: 13px; color: #fecaca;">Hard Deadline: ${new Date(graceEndsAt).toLocaleString()}</div>
  </div>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${checkinUrl}" style="background: #dc2626; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 700; font-size: 16px; display: inline-block;">
      🛑 STOP COUNTDOWN & CHECK IN
    </a>
  </div>
</div>
`;

    return this.send({ to, subject, html, text });
  }

  /**
   * Dispatches decrypted payload or recovery package to trusted contact upon switch trigger
   */
  async sendRecoveryDispatch({
    to,
    contactName,
    ownerEmail,
    switchName,
    customMessage,
    decryptedPayload,
    recoveryKeyHex,
  }) {
    const subject = `[RECOVERY NOTIFICATION] Critical Credentials Released: ${switchName}`;
    const text = `
Dear ${contactName},

You have been designated by ${ownerEmail} as a verified Trusted Contact in their Dead Man's Switch recovery system.
Because ${ownerEmail} has been inactive past their scheduled grace period, the recovery vault "${switchName}" has been officially triggered and unsealed.

Personal Note from Owner:
"${customMessage || 'No specific personal note left.'}"

----------------------------------------------------------------------
CONFIDENTIAL RECOVERY PAYLOAD / CREDENTIALS:
----------------------------------------------------------------------
${decryptedPayload}
----------------------------------------------------------------------

${recoveryKeyHex ? `DECRYPTION MASTER KEY (AES-256-GCM):\n${recoveryKeyHex}\n` : ''}

Please safeguard this information with extreme confidentiality.
Timestamp: ${new Date().toUTCString()}
`;

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
  <div style="border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 24px;">
    <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.15em; color: #10b981; text-transform: uppercase;">Aegis Secure Recovery Dispatch</span>
    <h2 style="margin: 8px 0 0 0; color: #ffffff; font-size: 22px;">Confidential Credentials Package</h2>
  </div>

  <p style="color: #94a3b8; font-size: 15px; line-height: 1.6;">
    Dear <strong style="color: #f8fafc;">${contactName}</strong>,<br><br>
    You are receiving this message because <strong style="color: #38bdf8;">${ownerEmail}</strong> appointed you as their emergency recovery contact.
    Their automated recovery switch <strong style="color: #f1f5f9;">"${switchName}"</strong> has triggered after an extended period of inactivity.
  </p>

  ${
    customMessage
      ? `
  <div style="background: #1e293b; border-left: 4px solid #10b981; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
    <div style="font-size: 12px; text-transform: uppercase; color: #10b981; font-weight: 600;">Personal Message from ${ownerEmail}:</div>
    <div style="font-size: 14px; color: #e2e8f0; font-style: italic; margin-top: 6px;">"${customMessage}"</div>
  </div>
  `
      : ''
  }

  <div style="margin: 24px 0;">
    <div style="font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 8px; text-transform: uppercase;">
      🔓 Unsealed Recovery Data & Credentials
    </div>
    <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 18px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 14px; color: #22c55e; white-space: pre-wrap; word-break: break-all;">${decryptedPayload}</div>
  </div>

  ${
    recoveryKeyHex
      ? `
  <div style="margin: 20px 0; background: #090d16; padding: 14px; border-radius: 6px; border: 1px dashed #334155;">
    <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">AES-256 Decryption Key:</div>
    <code style="color: #f59e0b; font-size: 13px; word-break: break-all;">${recoveryKeyHex}</code>
  </div>
  `
      : ''
  }

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center;">
    Dispatched securely via Aegis Recovery Vault • ${new Date().toUTCString()}
  </div>
</div>
`;

    return this.send({ to, subject, html, text });
  }
}

export const emailService = new EmailService();
