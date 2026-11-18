import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { UserRole } from '@prisma/client';

export interface CustomerJwtPayload extends JwtPayload {
  sub: string;
  telegramUserId: string;
  role: UserRole;
}

export interface AdminSessionPayload extends JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  csrfToken: string;
  type: 'admin_session';
}

export interface AdminTempTotpPayload extends JwtPayload {
  sub: string;
  email: string;
  type: 'admin_totp_pending';
}

// 1. Password Hashing with Argon2id
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// 2. Encryption for TOTP Secret at Rest (AES-256-GCM)
export function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(config.TOTP_ENCRYPTION_KEY.slice(0, 32), 'utf-8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptTotpSecret(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted TOTP secret format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = Buffer.from(config.TOTP_ENCRYPTION_KEY.slice(0, 32), 'utf-8');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 3. Customer Token (15-minute JWT)
export function signCustomerToken(user: { id: string; telegramUserId: bigint; role: UserRole }): string {
  return jwt.sign(
    {
      sub: user.id,
      telegramUserId: String(user.telegramUserId),
      role: user.role,
    },
    config.JWT_SECRET,
    { expiresIn: '15m' },
  );
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  return jwt.verify(token, config.JWT_SECRET) as CustomerJwtPayload;
}

// 4. Admin Session & Temporary TOTP Tokens
export function signAdminTempTotpToken(admin: { id: string; email: string }): string {
  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      type: 'admin_totp_pending',
    },
    config.ADMIN_SESSION_SECRET,
    { expiresIn: '5m' },
  );
}

export function verifyAdminTempTotpToken(token: string): AdminTempTotpPayload {
  const payload = jwt.verify(token, config.ADMIN_SESSION_SECRET) as AdminTempTotpPayload;
  if (payload.type !== 'admin_totp_pending') {
    throw new Error('Invalid token type for TOTP verification');
  }
  return payload;
}

export function signAdminSessionToken(admin: { id: string; email: string; role: UserRole }, csrfToken: string): string {
  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      csrfToken,
      type: 'admin_session',
    },
    config.ADMIN_SESSION_SECRET,
    { expiresIn: '12h' }, // 12-hour session lifetime
  );
}

export function verifyAdminSessionToken(token: string): AdminSessionPayload {
  const payload = jwt.verify(token, config.ADMIN_SESSION_SECRET) as AdminSessionPayload;
  if (payload.type !== 'admin_session') {
    throw new Error('Invalid token type for admin session');
  }
  return payload;
}

// 5. CSRF Token Generation
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
