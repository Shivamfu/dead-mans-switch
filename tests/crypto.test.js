import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encrypt,
  decrypt,
  envelopeEncrypt,
  envelopeDecrypt,
  generateRandomKeyHex,
  deriveKey,
} from '../src/crypto/cipher.js';
import {
  generateSecureToken,
  hashToken,
  createHmacSignature,
  verifyHmacSignature,
} from '../src/crypto/tokens.js';

test('Cryptography: AES-256-GCM Authenticated Encryption & Decryption', () => {
  const key = generateRandomKeyHex();
  const secretPayload = JSON.stringify({
    vault: 'Bitcoin Cold Storage',
    seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    pin: 4892,
  });

  const encrypted = encrypt(secretPayload, key);

  assert.ok(encrypted.ciphertext, 'Ciphertext should be generated');
  assert.ok(encrypted.iv, 'IV should be present');
  assert.ok(encrypted.tag, 'Authentication tag should be present');
  assert.notEqual(encrypted.ciphertext, secretPayload, 'Ciphertext must not match plaintext');

  // Successful decryption
  const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, key);
  assert.equal(decrypted, secretPayload, 'Decrypted text must match original secret');
});

test('Cryptography: AES-256-GCM Tamper Detection (Auth Tag verification)', () => {
  const key = generateRandomKeyHex();
  const secret = 'Top Secret Recovery Codes';
  const encrypted = encrypt(secret, key);

  // Tamper with ciphertext by modifying characters
  const tamperedCiphertext = encrypted.ciphertext.slice(0, -2) + '00';

  assert.throws(
    () => {
      decrypt(tamperedCiphertext, encrypted.iv, encrypted.tag, key);
    },
    /Unsupported state or unable to authenticate data/,
    'Decryption must fail if ciphertext is altered'
  );
});

test('Cryptography: Envelope Encryption & Decryption', () => {
  const masterPassword = 'super-secure-master-passphrase-2026';
  const confidentialNotes = 'Server SSH Root Key: ssh-ed25519 AAAAC3NzaC1...';

  const envelope = envelopeEncrypt(confidentialNotes, masterPassword);

  assert.ok(envelope.encryptedPayload);
  assert.ok(envelope.encryptedKey);
  assert.ok(envelope.rawKeyHex);

  const decrypted = envelopeDecrypt(
    envelope.encryptedPayload,
    envelope.iv,
    envelope.tag,
    envelope.encryptedKey,
    envelope.keyIv,
    envelope.keyTag,
    masterPassword
  );

  assert.equal(decrypted, confidentialNotes);
});

test('Tokens: Cryptographic check-in token hashing and HMAC verification', () => {
  const token = generateSecureToken();
  assert.equal(token.length, 64, 'Token should be 32 bytes (64 hex characters)');

  const hash1 = hashToken(token);
  const hash2 = hashToken(token);
  assert.equal(hash1, hash2, 'Hash must be deterministic');

  const payload = `switch-123:${Date.now()}`;
  const sig = createHmacSignature(payload);

  assert.ok(verifyHmacSignature(payload, sig), 'Valid signature should verify');
  const tamperedSig = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  assert.equal(verifyHmacSignature(payload, tamperedSig), false, 'Altered signature must fail verification');
});
