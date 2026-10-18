import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit encryption key from a secret or passphrase using Scrypt
 * @param {string} passphrase 
 * @param {string} [salt] 
 * @returns {Buffer} 32-byte key buffer
 */
export function deriveKey(passphrase, salt = config.systemMasterSalt) {
  return crypto.scryptSync(passphrase, salt, KEY_LENGTH);
}

/**
 * Generates a cryptographically random 256-bit key in hex format
 * @returns {string} 64-char hex string
 */
export function generateRandomKeyHex() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM
 * @param {string} plaintext - Plaintext data (JSON string or text)
 * @param {string|Buffer} key - 32-byte key (Buffer or hex string)
 * @param {string|Buffer} [associatedData] - Optional AAD (e.g. switch ID)
 * @returns {{ ciphertext: string, iv: string, tag: string }} Hex-encoded values
 */
export function encrypt(plaintext, key, associatedData = '') {
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH} bytes, got ${keyBuffer.length}`);
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  if (associatedData) {
    cipher.setAAD(Buffer.from(String(associatedData), 'utf8'));
  }

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypts AES-256-GCM ciphertext
 * @param {string} ciphertextHex - Hex-encoded ciphertext
 * @param {string} ivHex - Hex-encoded IV
 * @param {string} tagHex - Hex-encoded authentication tag
 * @param {string|Buffer} key - 32-byte key (Buffer or hex string)
 * @param {string|Buffer} [associatedData] - Optional AAD
 * @returns {string} Decrypted UTF-8 plaintext
 */
export function decrypt(ciphertextHex, ivHex, tagHex, key, associatedData = '') {
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH} bytes, got ${keyBuffer.length}`);
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);

  if (associatedData) {
    decipher.setAAD(Buffer.from(String(associatedData), 'utf8'));
  }

  let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Envelope encryption: Encrypts data with a unique per-item key,
 * then encrypts that item key with the server/system master key.
 * @param {string} plaintextData - Secrets or notes to encrypt
 * @param {string} masterKeySource - Passphrase or master salt
 * @param {string} [associatedData]
 * @returns {{ encryptedPayload: string, iv: string, tag: string, encryptedKey: string, keyIv: string, keyTag: string, rawKeyHex: string }}
 */
export function envelopeEncrypt(plaintextData, masterKeySource, associatedData = '') {
  // Generate random data encryption key (DEK)
  const dekHex = generateRandomKeyHex();
  const dekBuffer = Buffer.from(dekHex, 'hex');

  // Encrypt plaintext with DEK
  const payloadEncrypted = encrypt(plaintextData, dekBuffer, associatedData);

  // Derive Key Encryption Key (KEK) from masterKeySource
  const kek = deriveKey(masterKeySource, config.systemMasterSalt);

  // Encrypt DEK with KEK
  const keyEncrypted = encrypt(dekHex, kek, associatedData);

  return {
    encryptedPayload: payloadEncrypted.ciphertext,
    iv: payloadEncrypted.iv,
    tag: payloadEncrypted.tag,
    encryptedKey: keyEncrypted.ciphertext,
    keyIv: keyEncrypted.iv,
    keyTag: keyEncrypted.tag,
    rawKeyHex: dekHex,
  };
}

/**
 * Envelope decryption: Decrypts the DEK using the KEK, then decrypts the payload.
 * @param {string} encryptedPayload 
 * @param {string} iv 
 * @param {string} tag 
 * @param {string} encryptedKey 
 * @param {string} keyIv 
 * @param {string} keyTag 
 * @param {string} masterKeySource 
 * @param {string} [associatedData]
 * @returns {string} Plaintext
 */
export function envelopeDecrypt(
  encryptedPayload,
  iv,
  tag,
  encryptedKey,
  keyIv,
  keyTag,
  masterKeySource,
  associatedData = ''
) {
  const kek = deriveKey(masterKeySource, config.systemMasterSalt);
  const dekHex = decrypt(encryptedKey, keyIv, keyTag, kek, associatedData);
  return decrypt(encryptedPayload, iv, tag, Buffer.from(dekHex, 'hex'), associatedData);
}
