import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/index.js';
import { UserRole } from '@prisma/client';
import { verifyCustomerToken, verifyAdminSessionToken } from './crypto.js';
import { cache, CACHE_KEYS } from '../cache/index.js';
import { logger } from '../../logger/index.js';

export interface AuthenticatedCustomer {
  id: string;
  telegramUserId: string;
  role: UserRole;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isBlocked: boolean;
  hasAdminCredential?: boolean;
  adminEmail?: string | null;
  mustChangePassword?: boolean;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: UserRole;
  firstName: string | null;
  lastName: string | null;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedCustomer;
      admin?: AuthenticatedAdmin;
    }
  }
}

/**
 * Middleware: Verifies customer 15-minute Bearer JWT.
 */
export async function authenticateCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const requestId = req.headers['x-request-id'] as string;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header.',
        requestId,
      },
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  try {
    const payload = verifyCustomerToken(token);
    const cacheKey = CACHE_KEYS.USER_PROFILE(payload.sub);

    // High performance cache check (<1ms)
    let customer = await cache.get<AuthenticatedCustomer>(cacheKey);

    if (!customer) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        include: { adminCredential: true },
      });

      if (!user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'User belonging to this token no longer exists.',
            requestId,
          },
        });
        return;
      }

      customer = {
        id: user.id,
        telegramUserId: String(user.telegramUserId),
        role: user.role,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isBlocked: user.isBlocked,
        hasAdminCredential: Boolean(user.adminCredential),
        adminEmail: user.adminCredential?.email || null,
        mustChangePassword: user.adminCredential?.mustChangePassword ?? false,
      };

      // Cache authenticated profile for 120 seconds
      void cache.set(cacheKey, customer, 120);
    }

    if (customer.isBlocked) {
      res.status(403).json({
        error: {
          code: 'USER_BLOCKED',
          message: 'User account has been blocked.',
          requestId,
        },
      });
      return;
    }

    req.user = customer;
    next();
  } catch {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token.',
        requestId,
      },
    });
  }
}

/**
 * Middleware: Verifies admin session cookie + CSRF token for state-changing operations.
 */
export async function authenticateAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestId = req.headers['x-request-id'] as string;

  // Multi-channel session resolution: supports cross-site header (x-admin-session), cookie, and Bearer
  const candidates: string[] = [];
  const headerSession = req.headers['x-admin-session'];
  if (typeof headerSession === 'string' && headerSession.trim()) {
    candidates.push(headerSession.trim());
  }
  const cookieSession = req.cookies?.['admin_session'];
  if (typeof cookieSession === 'string' && cookieSession.trim()) {
    candidates.push(cookieSession.trim());
  }
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    candidates.push(authHeader.slice(7).trim());
  }

  if (candidates.length === 0) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin authentication required.',
        requestId,
      },
    });
    return;
  }

  let payload: ReturnType<typeof verifyAdminSessionToken> | null = null;
  for (const token of candidates) {
    try {
      const decoded = verifyAdminSessionToken(token);
      if (decoded && decoded.type === 'admin_session') {
        payload = decoded;
        break;
      }
    } catch {
      // test next candidate
    }
  }

  if (!payload) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired admin session.',
        requestId,
      },
    });
    return;
  }

  try {

    // CSRF verification on state-changing requests
    const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (stateChangingMethods.includes(req.method.toUpperCase())) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== payload.csrfToken) {
        res.status(403).json({
          error: {
            code: 'INVALID_CSRF_TOKEN',
            message: 'Invalid or missing CSRF token.',
            requestId,
          },
        });
        return;
      }
    }

    // Verify admin exists and has valid role
    const admin = await prisma.adminCredential.findUnique({
      where: { userId: payload.sub },
      include: { user: true },
    });

    if (!admin || (admin.user.role !== UserRole.ADMIN && admin.user.role !== UserRole.SUPERADMIN)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Access restricted to active administrators.',
          requestId,
        },
      });
      return;
    }

    // Check if account has been deactivated (revoked role)
    const isDeactivated = Boolean(admin.lockedUntil && admin.lockedUntil.getFullYear() >= 9000);
    if (isDeactivated) {
      res.status(403).json({
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'This administrator account has been deactivated. Access revoked.',
          requestId,
        },
      });
      return;
    }

    req.admin = {
      id: admin.user.id,
      email: admin.email,
      role: admin.user.role,
      firstName: admin.user.firstName,
      lastName: admin.user.lastName,
      mustChangePassword: admin.mustChangePassword,
    };

    // Strict First-Login Policy: If mustChangePassword is true, block all operations until password is changed
    const isAllowedBeforePasswordChange =
      req.originalUrl?.includes('/change-password') ||
      req.originalUrl?.endsWith('/me') ||
      req.originalUrl?.includes('/logout') ||
      req.path.includes('change-password') ||
      req.path.endsWith('/me') ||
      req.path.includes('logout');

    if (admin.mustChangePassword && !isAllowedBeforePasswordChange) {
      res.status(403).json({
        error: {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Password change required upon first login before accessing administrative features.',
          requestId,
        },
      });
      return;
    }

    next();
  } catch (err: unknown) {
    logger.error({ err, requestId }, 'Admin authentication execution error');
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired admin session.',
        requestId,
      },
    });
  }
}

/**
 * Middleware: Role checking helper.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.headers['x-request-id'] as string;
    const currentRole = req.admin?.role || req.user?.role;

    if (!currentRole || !allowedRoles.includes(currentRole)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
          requestId,
        },
      });
      return;
    }

    next();
  };
}
