const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataPath, ensureDir } = require('./runtime-paths');

const ALGORITHM = 'aes-256-gcm';
const LEGACY_KEY_SEED = 'mepbridge-local-llm-config-key-v1';
const KEY_FILE = dataPath('secrets', 'llm-config-key');

function readOrCreateLocalKey() {
  ensureDir(path.dirname(KEY_FILE));

  if (fs.existsSync(KEY_FILE)) {
    const existing = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (existing) return Buffer.from(existing, 'hex');
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

function currentKey() {
  if (process.env.LLM_CONFIG_KEY) {
    return crypto.createHash('sha256').update(process.env.LLM_CONFIG_KEY).digest();
  }
  return readOrCreateLocalKey();
}

function legacyKey() {
  return crypto.createHash('sha256').update(LEGACY_KEY_SEED).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, currentKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyVersion: process.env.LLM_CONFIG_KEY ? 'env-sha256' : 'local-v2'
  };
}

function decryptWithKey(encryptedData, key) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encryptedData.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function decrypt(encryptedData) {
  try {
    return decryptWithKey(encryptedData, currentKey());
  } catch (currentError) {
    try {
      return decryptWithKey(encryptedData, legacyKey());
    } catch (_) {
      throw currentError;
    }
  }
}

module.exports = {
  encrypt,
  decrypt,
  KEY_FILE
};
