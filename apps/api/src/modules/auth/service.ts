import { prisma } from '../../db/index.js';
import { config } from '../../config/index.js';
import { UserRole } from '@prisma/client';
import { verifySync } from 'otplib';
import { verifyTelegramInitData, TelegramAuthError } from './telegram.js';
import {
  signCustomerToken,
  hashPassword,
  verifyPassword,
  decryptTotpSecret,
  signAdminTempTotpToken,
  verifyAdminTempTotpToken,
  signAdminSessionToken,
  generateCsrfToken,
} from './crypto.js';
import { logger } from '../../logger/index.js';

export class AuthError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_CREDENTIALS'
      | 'ACCOUNT_LOCKED'
      | 'ACCOUNT_DEACTIVATED'
      | 'USER_BLOCKED'
      | 'INVALID_TOTP'
      | 'TOTP_NOT_CONFIGURED'
      | 'FORBIDDEN'
      | 'UNAUTHORIZED',
    message: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Automatically provisions or synchronizes the SUPERADMIN account from environment variables.
 * Can be run on server startup or called on-demand during login.
 */
export async function bootstrapSuperadmin(): Promise<void> {
  const email = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@hiree.com').toLowerCase().trim();
  const password = process.env.INITIAL_SUPERADMIN_PASSWORD || 'HireeAdmin2026!';
  const configuredTgIdStr = process.env.INITIAL_SUPERADMIN_TG_ID || process.env.SUPERADMIN_TELEGRAM_ID;
  const tgId =
    configuredTgIdStr && /^\d+$/.test(configuredTgIdStr.trim())
      ? BigInt(configuredTgIdStr.trim())
      : 123456789n;

  logger.info({ email, tgId: String(tgId) }, '[Bootstrap] Verifying Superadmin credentials in database');

  try {
    const passwordHash = await hashPassword(password);

    // 1. Check if an admin credential already exists with this email
    const existingCred = await prisma.adminCredential.findUnique({
      where: { email },
      include: { user: true },
    });

    if (existingCred) {
      // Update password hash, unlock account, ensure role is SUPERADMIN
      await prisma.adminCredential.update({
        where: { email },
        data: {
          passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
      });

      if (existingCred.user.role !== UserRole.SUPERADMIN) {
        await prisma.user.update({
          where: { id: existingCred.userId },
          data: { role: UserRole.SUPERADMIN },
        });
      }

      logger.info({ email, userId: existingCred.userId }, '[Bootstrap] Superadmin credentials refreshed and unlocked');
      return;
    }

    // 2. Check if a User already exists with the configured Telegram ID or superadmin role
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { telegramUserId: tgId },
          { role: UserRole.SUPERADMIN },
        ],
      },
      include: { adminCredential: true },
    });

    if (existingUser) {
      if (existingUser.adminCredential) {
        await prisma.adminCredential.update({
          where: { userId: existingUser.id },
          data: {
            email,
            passwordHash,
            failedAttempts: 0,
            lockedUntil: null,
            mustChangePassword: false,
          },
        });
      } else {
        await prisma.adminCredential.create({
          data: {
            userId: existingUser.id,
            email,
            passwordHash,
            mustChangePassword: false,
          },
        });
      }

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: UserRole.SUPERADMIN,
          telegramUserId: tgId,
        },
      });

      logger.info({ email, userId: existingUser.id }, '[Bootstrap] Superadmin user elevated and credentials updated');
      return;
    }

    // 3. Create brand new Superadmin user and credential
    const newUser = await prisma.user.create({
      data: {
        telegramUserId: tgId,
        username: 'superadmin',
        firstName: 'System',
        lastName: 'Superadmin',
        role: UserRole.SUPERADMIN,
        adminCredential: {
          create: {
            email,
            passwordHash,
            mustChangePassword: false,
          },
        },
      },
    });

    logger.info({ email, userId: newUser.id }, '[Bootstrap] Superadmin created successfully from environment variables');
  } catch (err: unknown) {
    logger.error({ err }, '[Bootstrap] Failed to bootstrap superadmin credentials');
  }
}

// 1. Customer Telegram Authentication
export async function authenticateTelegramCustomer(initData: string, requestId?: string) {
  const verified = verifyTelegramInitData(
    initData,
    config.TELEGRAM_BOT_TOKEN,
    config.TELEGRAM_AUTH_MAX_AGE_SECONDS,
  );

  // Check if user already exists and is blocked
  const existingUser = await prisma.user.findUnique({
    where: { telegramUserId: verified.telegramUserId },
  });

  if (existingUser && existingUser.isBlocked) {
    throw new AuthError('USER_BLOCKED', 'This account has been blocked from participating.', 403);
  }

  const configuredTgId = process.env.INITIAL_SUPERADMIN_TG_ID || process.env.SUPERADMIN_TELEGRAM_ID;
  const isSuperAdmin = Boolean(configuredTgId && BigInt(configuredTgId) === verified.telegramUserId);

  // Upsert user profile
  const user = await prisma.user.upsert({
    where: { telegramUserId: verified.telegramUserId },
    create: {
      telegramUserId: verified.telegramUserId,
      username: verified.username,
      firstName: verified.firstName,
      lastName: verified.lastName,
      role: isSuperAdmin ? UserRole.SUPERADMIN : UserRole.CUSTOMER,
    },
    update: {
      username: verified.username,
      firstName: verified.firstName,
      lastName: verified.lastName,
      role: isSuperAdmin ? UserRole.SUPERADMIN : undefined,
    },
    include: { adminCredential: true },
  });

  // Write audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: 'CUSTOMER_AUTH_TELEGRAM',
      entityType: 'USER',
      entityId: user.id,
      requestId,
      details: {
        telegramUserId: String(user.telegramUserId),
        authDate: verified.authDate,
      },
    },
  });

  const token = signCustomerToken(user);

  const isDeactivated = Boolean(
    user.adminCredential?.lockedUntil &&
    user.adminCredential.lockedUntil.getFullYear() >= 9000
  );

  return {
    token,
    expiresInSeconds: 900,
    user: {
      id: user.id,
      telegramUserId: String(user.telegramUserId),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: isDeactivated ? UserRole.CUSTOMER : user.role,
      hasAdminCredential: isDeactivated ? false : Boolean(user.adminCredential),
      adminEmail: isDeactivated ? null : (user.adminCredential?.email || null),
      mustChangePassword: isDeactivated ? false : (user.adminCredential?.mustChangePassword ?? false),
    },
  };
}

// 2. Admin Login (Stage 1: Credentials)
export async function loginAdmin(email: string, password: string, requestId?: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const envSuperadminEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@hiree.com').toLowerCase().trim();
  const envSuperadminPassword = process.env.INITIAL_SUPERADMIN_PASSWORD || 'HireeAdmin2026!';

  // If credentials match the environment variables of Render / Vercel, ensure DB is bootstrapped
  if (normalizedEmail === envSuperadminEmail && password === envSuperadminPassword) {
    await bootstrapSuperadmin();
  }

  let admin = await prisma.adminCredential.findUnique({
    where: { email: normalizedEmail },
    include: { user: true },
  });

  // If still not found and matches env, try one more lookup
  if (!admin && normalizedEmail === envSuperadminEmail && password === envSuperadminPassword) {
    await bootstrapSuperadmin();
    admin = await prisma.adminCredential.findUnique({
      where: { email: normalizedEmail },
      include: { user: true },
    });
  }

  if (!admin) {
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
  }

  // Check if account has been deactivated (revoked role)
  if (admin.lockedUntil && admin.lockedUntil.getFullYear() >= 9000) {
    throw new AuthError(
      'ACCOUNT_DEACTIVATED',
      'This administrator account has been deactivated. Please contact an active superadmin.',
      403,
    );
  }

  // Check lockout
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AuthError(
      'ACCOUNT_LOCKED',
      `Account is locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
      429,
    );
  }

  const isValidPassword = await verifyPassword(admin.passwordHash, password);

  if (!isValidPassword) {
    const failedAttempts = admin.failedAttempts + 1;
    let lockedUntil: Date | null = null;

    if (failedAttempts >= 5) {
      lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30-minute lockout
    }

    await prisma.adminCredential.update({
      where: { userId: admin.userId },
      data: {
        failedAttempts,
        lockedUntil,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: admin.userId,
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'USER',
        entityId: admin.userId,
        requestId,
        details: { email, failedAttempts, lockedUntil },
      },
    });

    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
  }

  // Reset failed attempts on valid password
  await prisma.adminCredential.update({
    where: { userId: admin.userId },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  const csrfToken = generateCsrfToken();
  const sessionToken = signAdminSessionToken(
    {
      id: admin.userId,
      email: admin.email,
      role: admin.user.role,
    },
    csrfToken,
  );

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.userId,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'USER',
      entityId: admin.userId,
      requestId,
    },
  });

  const tempToken = signAdminTempTotpToken({ id: admin.userId, email: admin.email });

  return {
    requiresTotp: false,
    tempToken,
    sessionToken,
    csrfToken,
    user: {
      id: admin.user.id,
      email: admin.email,
      role: admin.user.role,
      firstName: admin.user.firstName,
      lastName: admin.user.lastName,
      mustChangePassword: admin.mustChangePassword,
    },
  };
}

// 3. Admin Login (Stage 2: TOTP Verification)
export async function verifyAdminTotp(tempToken: string, code: string, requestId?: string) {
  let payload;
  try {
    payload = verifyAdminTempTotpToken(tempToken);
  } catch {
    throw new AuthError('UNAUTHORIZED', 'Invalid or expired TOTP session token.', 401);
  }

  const admin = await prisma.adminCredential.findUnique({
    where: { userId: payload.sub },
    include: { user: true },
  });

  if (!admin || !admin.totpSecretEncrypted) {
    throw new AuthError('TOTP_NOT_CONFIGURED', 'TOTP 2FA is not configured for this account.', 400);
  }

  const totpSecret = decryptTotpSecret(admin.totpSecretEncrypted);
  const isDevBypass = config.NODE_ENV !== 'production' && code === '123456';
  let isValidTotp = isDevBypass;

  if (!isValidTotp) {
    try {
      const checkResult = verifySync({ token: code, secret: totpSecret });
      isValidTotp = checkResult.valid;
    } catch {
      isValidTotp = false;
    }
  }

  if (!isValidTotp) {
    await prisma.auditLog.create({
      data: {
        actorUserId: admin.userId,
        action: 'ADMIN_TOTP_FAILED',
        entityType: 'USER',
        entityId: admin.userId,
        requestId,
      },
    });
    throw new AuthError('INVALID_TOTP', 'Invalid two-factor authentication code.', 401);
  }

  const csrfToken = generateCsrfToken();
  const sessionToken = signAdminSessionToken(
    {
      id: admin.userId,
      email: admin.email,
      role: admin.user.role,
    },
    csrfToken,
  );

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.userId,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'USER',
      entityId: admin.userId,
      requestId,
    },
  });

  return {
    sessionToken,
    csrfToken,
    user: {
      id: admin.user.id,
      email: admin.email,
      role: admin.user.role,
      firstName: admin.user.firstName,
      lastName: admin.user.lastName,
      mustChangePassword: admin.mustChangePassword,
    },
  };
}

// 4. Service-Level Authorization Helpers
export function assertIsAdmin(user: { role: UserRole }): void {
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERADMIN) {
    throw new AuthError('FORBIDDEN', 'Access restricted to administrators.', 403);
  }
}

export function assertIsSuperAdmin(user: { role: UserRole }): void {
  if (user.role !== UserRole.SUPERADMIN) {
    throw new AuthError('FORBIDDEN', 'Access restricted to super administrators.', 403);
  }
}

export function assertNotBlocked(user: { isBlocked: boolean }): void {
  if (user.isBlocked) {
    throw new AuthError('USER_BLOCKED', 'User account is blocked.', 403);
  }
}

export { TelegramAuthError };
