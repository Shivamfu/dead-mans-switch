import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Generates a cryptographically secure random token (64 hex characters)
 * @returns {string}
 */
export function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates an API key with a identifiable prefix
 * @returns {string} e.g. "dms_key_a83f9...
 */
export function generateApiKey() {
  return `dms_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Hashes a token using SHA-256 for safe database storage
 * @param {string} token 
 * @returns {string} 64-char hex hash
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Creates an HMAC signature for a check-in payload (switchId:expiry)
 * @param {string} data 
 * @returns {string}
 */
export function createHmacSignature(data) {
  return crypto.createHmac('sha256', config.jwtSecret).update(data).digest('hex');
}

/**
 * Verifies an HMAC signature using timingSafeEqual to protect against timing attacks
 * @param {string} data 
 * @param {string} signature 
 * @returns {boolean}
 */
export function verifyHmacSignature(data, signature) {
  const expected = createHmacSignature(data);
  const bufExpected = Buffer.from(expected, 'hex');
  const bufActual = Buffer.from(signature, 'hex');

  if (bufExpected.length !== bufActual.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufExpected, bufActual);
}
