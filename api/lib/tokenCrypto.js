import crypto from 'crypto';

// AES-256-GCM for stored OAuth refresh tokens. Each provider has its own key
// (env var holding 32 random bytes, base64), so one leaked key opens one provider.
export function tokenSealer(envName) {
  const key = () => {
    const k = Buffer.from(process.env[envName] || '', 'base64');
    if (k.length !== 32) throw new Error(`${envName} is not configured (needs 32 random bytes, base64)`);
    return k;
  };
  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
    },
    decrypt(enc) {
      const [, iv, tag, ct] = enc.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
