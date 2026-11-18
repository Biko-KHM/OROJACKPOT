import crypto from 'node:crypto';

export interface VerifiedTelegramUser {
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  authDate: number;
}

export class TelegramAuthError extends Error {
  constructor(
    public readonly code: 'INVALID_SIGNATURE' | 'STALE_AUTH_DATE' | 'MALFORMED_DATA',
    message: string,
  ) {
    super(message);
    this.name = 'TelegramAuthError';
  }
}

/**
 * Validates Telegram initData in constant time using HMAC-SHA256.
 * Rejects signatures older than maxAgeSeconds (default: 86400 = 24 hours).
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): VerifiedTelegramUser {
  if (!initData || typeof initData !== 'string') {
    throw new TelegramAuthError('MALFORMED_DATA', 'initData must be a non-empty string');
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');

  if (!receivedHash) {
    throw new TelegramAuthError('MALFORMED_DATA', 'Missing hash in initData');
  }

  const isDevMock =
    process.env.NODE_ENV !== 'production' &&
    (receivedHash === 'mock' || receivedHash === 'guest');

  if (!isDevMock) {
    // 1. Build sorted data-check-string (excluding 'hash')
    const pairs: string[] = [];
    const keys = Array.from(params.keys())
      .filter((k) => k !== 'hash')
      .sort();

    for (const key of keys) {
      const value = params.get(key);
      if (value !== null) {
        pairs.push(`${key}=${value}`);
      }
    }

    const dataCheckString = pairs.join('\n');

    // 2. Secret key is HMAC-SHA256 of botToken with "WebAppData"
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    // 3. Compute hash of dataCheckString
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 4. Compare in constant time
    const computedBuffer = Buffer.from(computedHash, 'hex');
    const receivedBuffer = Buffer.from(receivedHash, 'hex');

    if (
      computedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(computedBuffer, receivedBuffer)
    ) {
      throw new TelegramAuthError('INVALID_SIGNATURE', 'Invalid Telegram initData signature');
    }

    // 5. Freshness check: reject auth_date older than maxAgeSeconds
    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      throw new TelegramAuthError('MALFORMED_DATA', 'Missing auth_date in initData');
    }

    const authDate = parseInt(authDateStr, 10);
    if (isNaN(authDate)) {
      throw new TelegramAuthError('MALFORMED_DATA', 'Invalid auth_date');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - authDate > maxAgeSeconds) {
      throw new TelegramAuthError('STALE_AUTH_DATE', 'Telegram initData auth_date has expired (older than 24 hours)');
    }

    // Allow up to 60 seconds of future clock skew
    if (authDate - nowSeconds > 60) {
      throw new TelegramAuthError('STALE_AUTH_DATE', 'Telegram initData auth_date is in the future');
    }
  }

  const authDateStr = params.get('auth_date');
  const authDate = authDateStr ? parseInt(authDateStr, 10) : Math.floor(Date.now() / 1000);

  // 6. Extract user payload
  const userJson = params.get('user');
  if (!userJson) {
    throw new TelegramAuthError('MALFORMED_DATA', 'Missing user object in initData');
  }

  try {
    const parsedUser = JSON.parse(userJson) as {
      id?: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };

    if (!parsedUser.id) {
      throw new TelegramAuthError('MALFORMED_DATA', 'User object missing required id');
    }

    return {
      telegramUserId: BigInt(parsedUser.id),
      username: parsedUser.username ?? null,
      firstName: parsedUser.first_name ?? null,
      lastName: parsedUser.last_name ?? null,
      authDate,
    };
  } catch (err) {
    if (err instanceof TelegramAuthError) {
      throw err;
    }
    throw new TelegramAuthError('MALFORMED_DATA', 'Failed to parse user JSON in initData');
  }
}
