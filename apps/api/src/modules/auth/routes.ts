import { Router, Request, Response } from 'express';
import {
  TelegramAuthRequestSchema,
  AdminLoginRequestSchema,
  AdminTotpRequestSchema,
} from '@tg-lottery/shared';
import {
  authenticateTelegramCustomer,
  loginAdmin,
  verifyAdminTotp,
  AuthError,
  TelegramAuthError,
} from './service.js';
import { authenticateCustomer, authenticateAdmin } from './middleware.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { prisma } from '../../db/index.js';
import { config } from '../../config/index.js';

export const authRouter = Router();

// 1. POST /auth/telegram
authRouter.post('/telegram', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const parsed = TelegramAuthRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const result = await authenticateTelegramCustomer(parsed.data.initData, requestId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TelegramAuthError) {
      res.status(401).json({
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      });
      return;
    }

    if (err instanceof AuthError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      });
      return;
    }

    throw err;
  }
});

// 2. GET /me (Customer Profile)
authRouter.get('/me', authenticateCustomer, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});

// Admin Auth Router
export const adminAuthRouter = Router();

// 3. POST /admin/auth/login
adminAuthRouter.post('/login', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const parsed = AdminLoginRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid email or password format',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const result = await loginAdmin(parsed.data.email, parsed.data.password, requestId);

    if (result.sessionToken) {
      res.cookie('admin_session', result.sessionToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
        // Omit maxAge so cookie is automatically discarded when the browser / Mini App is closed
      });
    }

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      });
      return;
    }
    throw err;
  }
});

// 4. POST /admin/auth/totp
adminAuthRouter.post('/totp', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const parsed = AdminTotpRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid TOTP request format',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const result = await verifyAdminTotp(parsed.data.tempToken, parsed.data.code, requestId);

    // Set secure HTTP-only session cookie for admin session (discarded on browser/app close)
    res.cookie('admin_session', result.sessionToken, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
      // Omit maxAge so cookie is automatically discarded when the browser / Mini App is closed
    });

    res.status(200).json({
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      });
      return;
    }
    throw err;
  }
});

// 5. POST /admin/auth/logout
adminAuthRouter.post('/logout', authenticateAdmin, (_req: Request, res: Response) => {
  res.clearCookie('admin_session', {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  res.status(200).json({ success: true });
});

// 6. GET /admin/me (Protected Admin Profile)
adminAuthRouter.get('/me', authenticateAdmin, (req: Request, res: Response) => {
  res.status(200).json({ admin: req.admin });
});

// 7. POST /admin/auth/change-password
adminAuthRouter.post('/change-password', authenticateAdmin, async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const requestId = req.headers['x-request-id'] as string;
  const { currentPassword, newPassword } = req.body || {};

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'New password must be at least 8 characters long',
        requestId,
      },
    });
    return;
  }

  const credential = await prisma.adminCredential.findUnique({
    where: { userId: currentAdmin.id },
  });

  if (!credential) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Admin credential record not found',
        requestId,
      },
    });
    return;
  }

  // If currentPassword is provided, verify it against existing hash
  if (currentPassword) {
    const isValid = await verifyPassword(credential.passwordHash, String(currentPassword));
    if (!isValid) {
      res.status(400).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Current password does not match',
          requestId,
        },
      });
      return;
    }
  }

  const newHash = await hashPassword(String(newPassword));

  await prisma.adminCredential.update({
    where: { userId: currentAdmin.id },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: currentAdmin.id,
      requestId,
      details: { email: currentAdmin.email },
    },
  });

  res.status(200).json({
    success: true,
    message: 'Password successfully updated.',
  });
});
