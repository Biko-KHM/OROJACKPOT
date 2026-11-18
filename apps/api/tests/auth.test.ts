import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { generateSecret, generateSync } from 'otplib';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { config } from '../src/config/index.js';
import { UserRole } from '@prisma/client';
import { hashPassword, encryptTotpSecret } from '../src/modules/auth/crypto.js';

function createMockTelegramInitData(
  botToken: string,
  user: { id: number; first_name: string; username?: string },
  authDate: number = Math.floor(Date.now() / 1000),
  tamper = false,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc');
  params.set('user', JSON.stringify(user));

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  let hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (tamper) {
    hash = hash.slice(0, -4) + (hash.endsWith('a') ? 'b' : 'a') + 'bc';
  }
  params.set('hash', hash);
  return params.toString();
}

describe('Step 2: Authentication Module', () => {
  const testAdminEmail = `admin_${crypto.randomUUID().slice(0, 8)}@example.com`;
  const testAdminPassword = 'StrongAdminPassword123!';
  const totpSecret = generateSecret();
  let testAdminUserId: string;
  let testCustomerToken: string;

  beforeAll(async () => {
    // Create an Admin user with TOTP enrolled
    const hashedPassword = await hashPassword(testAdminPassword);
    const encryptedSecret = encryptTotpSecret(totpSecret);

    const adminUser = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 2000000),
        username: 'admin_test',
        firstName: 'Admin',
        role: UserRole.ADMIN,
        adminCredential: {
          create: {
            email: testAdminEmail,
            passwordHash: hashedPassword,
            totpSecretEncrypted: encryptedSecret,
          },
        },
      },
    });
    testAdminUserId = adminUser.id;
  });

  afterAll(async () => {
    try { await prisma.adminCredential.deleteMany({ where: { userId: testAdminUserId } }); } catch { /* ignore */ }
    try { await prisma.user.deleteMany({ where: { id: testAdminUserId } }); } catch { /* ignore */ }
    await prisma.$disconnect();
  });

  describe('Customer Telegram Authentication (POST /auth/telegram)', () => {
    it('authenticates valid Telegram initData, upserts user, and returns 15-minute JWT', async () => {
      const mockUser = { id: 888777666, first_name: 'Bikila', username: 'biko_lottery' };
      const initData = createMockTelegramInitData(config.TELEGRAM_BOT_TOKEN, mockUser);

      const res = await request(app)
        .post('/auth/telegram')
        .send({ initData });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.expiresInSeconds).toBe(900);
      expect(res.body.user.telegramUserId).toBe('888777666');
      expect(res.body.user.role).toBe(UserRole.CUSTOMER);

      testCustomerToken = res.body.token;

      // Accessing /auth/me with the customer token must succeed
      const meRes = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${testCustomerToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.username).toBe('biko_lottery');

      // Accessing /me/tickets with the customer token must succeed
      const ticketsRes = await request(app)
        .get('/me/tickets')
        .set('Authorization', `Bearer ${testCustomerToken}`);

      expect(ticketsRes.status).toBe(200);
      expect(Array.isArray(ticketsRes.body)).toBe(true);

      // Accessing /api/v1/me/tickets must also succeed
      const v1TicketsRes = await request(app)
        .get('/api/v1/me/tickets')
        .set('Authorization', `Bearer ${testCustomerToken}`);

      expect(v1TicketsRes.status).toBe(200);
      expect(Array.isArray(v1TicketsRes.body)).toBe(true);
    });

    it('rejects tampered Telegram initData with 401', async () => {
      const mockUser = { id: 888777666, first_name: 'Bikila' };
      const tamperedInitData = createMockTelegramInitData(config.TELEGRAM_BOT_TOKEN, mockUser, undefined, true);

      const res = await request(app)
        .post('/auth/telegram')
        .send({ initData: tamperedInitData });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('rejects stale Telegram initData older than 24 hours with 401', async () => {
      const mockUser = { id: 888777666, first_name: 'Bikila' };
      const staleAuthDate = Math.floor(Date.now() / 1000) - (86400 + 60); // 24 hours + 1 min ago
      const staleInitData = createMockTelegramInitData(config.TELEGRAM_BOT_TOKEN, mockUser, staleAuthDate);

      const res = await request(app)
        .post('/auth/telegram')
        .send({ initData: staleInitData });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('STALE_AUTH_DATE');
    });

    it('rejects blocked customer with 403', async () => {
      const blockedTgId = BigInt(Math.floor(Math.random() * 1000000000) + 3000000);
      await prisma.user.create({
        data: {
          telegramUserId: blockedTgId,
          username: 'blocked_user',
          isBlocked: true,
          role: UserRole.CUSTOMER,
        },
      });

      const initData = createMockTelegramInitData(config.TELEGRAM_BOT_TOKEN, {
        id: Number(blockedTgId),
        first_name: 'Blocked',
      });

      const res = await request(app)
        .post('/auth/telegram')
        .send({ initData });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('USER_BLOCKED');
    });
  });

  describe('Admin Authentication & TOTP Flow', () => {
    let tempToken: string;
    let adminSessionCookie: string;
    let csrfToken: string;

    it('rejects invalid admin password with 401', async () => {
      const res = await request(app)
        .post('/admin/auth/login')
        .send({ email: testAdminEmail, password: 'WrongPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('login succeeds directly without 2FA and sets session cookie and CSRF token', async () => {
      const res = await request(app)
        .post('/admin/auth/login')
        .send({ email: testAdminEmail, password: testAdminPassword });

      expect(res.status).toBe(200);
      expect(res.body.requiresTotp).toBe(false);
      expect(res.body.csrfToken).toBeDefined();
      expect(res.body.user.email).toBe(testAdminEmail);

      const setCookieHeader = res.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join(';') : String(setCookieHeader);
      expect(cookieStr).toContain('admin_session=');

      const match = cookieStr.match(/admin_session=[^;]+/);
      expect(match).not.toBeNull();
      adminSessionCookie = match ? match[0] : '';
      csrfToken = res.body.csrfToken;
    });

    it('forces newly created admin with mustChangePassword: true to change password before calling admin routes', async () => {
      const tempEmail = `force_pwd_${Date.now()}@lottery.et`;
      const tempHash = await hashPassword('TempPassword123!');
      const newAdminUser = await prisma.user.create({
        data: {
          telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 4000000),
          username: 'force_pwd_user',
          role: UserRole.ADMIN,
          adminCredential: {
            create: {
              email: tempEmail,
              passwordHash: tempHash,
              mustChangePassword: true,
            },
          },
        },
      });

      const loginRes = await request(app)
        .post('/admin/auth/login')
        .send({ email: tempEmail, password: 'TempPassword123!' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.mustChangePassword).toBe(true);
      const newCookie = loginRes.headers['set-cookie'][0].split(';')[0];
      const newCsrf = loginRes.body.csrfToken;

      // Accessing administrative endpoint is blocked with 403 PASSWORD_CHANGE_REQUIRED
      const blockedRes = await request(app)
        .get('/admin/audit-logs')
        .set('Cookie', newCookie);

      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Submitting change-password succeeds
      const changeRes = await request(app)
        .post('/admin/auth/change-password')
        .set('Cookie', newCookie)
        .set('x-csrf-token', newCsrf)
        .send({ newPassword: 'NewPermanentPassword123!', currentPassword: 'TempPassword123!' });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.success).toBe(true);

      // Now accessing administrative endpoint succeeds
      const allowedRes = await request(app)
        .get('/admin/audit-logs')
        .set('Cookie', newCookie);

      expect(allowedRes.status).toBe(200);

      try {
        await prisma.adminCredential.deleteMany({ where: { userId: newAdminUser.id } });
        await prisma.user.deleteMany({ where: { id: newAdminUser.id } });
      } catch { /* ignore */ }
    });

    it('allows access to protected admin route when authenticated with session cookie', async () => {
      const res = await request(app)
        .get('/admin/me')
        .set('Cookie', adminSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.admin.email).toBe(testAdminEmail);
      expect(res.body.admin.role).toBe(UserRole.ADMIN);
    });

    it('validates CSRF token on state-changing admin operations (logout)', async () => {
      // POST without CSRF token should fail with 403
      const noCsrfRes = await request(app)
        .post('/admin/auth/logout')
        .set('Cookie', adminSessionCookie);

      expect(noCsrfRes.status).toBe(403);
      expect(noCsrfRes.body.error.code).toBe('INVALID_CSRF_TOKEN');

      // POST with valid CSRF token succeeds
      const validCsrfRes = await request(app)
        .post('/admin/auth/logout')
        .set('Cookie', adminSessionCookie)
        .set('x-csrf-token', csrfToken);

      expect(validCsrfRes.status).toBe(200);
      expect(validCsrfRes.body.success).toBe(true);
    });

    it('proves customer token cannot call admin routes (acceptance test)', async () => {
      const res = await request(app)
        .get('/admin/me')
        .set('Authorization', `Bearer ${testCustomerToken}`);

      expect(res.status).toBe(401); // Customer token is not an admin session token
    });
  });
});
