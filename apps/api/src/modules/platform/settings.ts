import { config } from '../../config/index.js';
import { prisma } from '../../db/index.js';
import { cache, CACHE_KEYS } from '../cache/index.js';
import { getTelegramClient } from '../telegram/client.js';
import { logger } from '../../logger/index.js';

export interface PlatformSettingsState {
  dualApprovalRequired?: boolean;
  dualApprovalThresholdMinor?: string;
  reviewEscalationDelayMinutes?: number;
  maintenanceMode?: boolean;
  customerSupportTelegram?: string;
  telegramChannelId?: string;
}

let platformSettings: PlatformSettingsState = {
  dualApprovalRequired: false,
  dualApprovalThresholdMinor: '1000000',
  reviewEscalationDelayMinutes: 120,
  maintenanceMode: false,
  customerSupportTelegram: '@orojackpotsupport',
  telegramChannelId: config.TELEGRAM_CHANNEL_ID || '',
};

let cachedBotUsername: string | null = null;
let lastBotInfoFetch = 0;

/**
 * Returns the currently active Telegram Channel ID (from database / superadmin settings).
 * Does not require TELEGRAM_CHANNEL_ID in environment variables.
 */
export function getPlatformTelegramChannelId(): string {
  return platformSettings.telegramChannelId || config.TELEGRAM_CHANNEL_ID || '';
}

export function getPlatformSettings(): PlatformSettingsState {
  return { ...platformSettings };
}

export function updatePlatformSettingsState(patch: Partial<PlatformSettingsState>): PlatformSettingsState {
  platformSettings = {
    ...platformSettings,
    ...patch,
  };
  if (typeof patch.telegramChannelId === 'string') {
    platformSettings.telegramChannelId = patch.telegramChannelId.trim();
    (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
  }
  return platformSettings;
}

/**
 * Dynamically resolves the Telegram Bot's username using getMe() via Bot Token.
 * Cached for 5 minutes to avoid rate limits.
 * If the username is changed in @BotFather, this updates automatically without frontend redeployment.
 */
export async function getBotUsername(): Promise<string> {
  const now = Date.now();
  if (cachedBotUsername && now - lastBotInfoFetch < 300_000) {
    return cachedBotUsername;
  }

  try {
    const client = getTelegramClient();
    if (config.TELEGRAM_BOT_TOKEN && !config.TELEGRAM_BOT_TOKEN.includes('dummy')) {
      const me = await client.getMe();
      if (me && me.username) {
        cachedBotUsername = me.username;
        lastBotInfoFetch = now;
        return cachedBotUsername;
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to fetch bot username via Telegram getMe');
  }

  return cachedBotUsername || 'OrojackpotBot';
}

/**
 * Bootstrap saved settings from cache or DB audit log on startup
 */
export async function initPlatformSettings(): Promise<void> {
  try {
    const cached = await cache.get<string>(CACHE_KEYS.PLATFORM_SETTINGS);
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      platformSettings = { ...platformSettings, ...(parsed as Partial<PlatformSettingsState>) };
      if (platformSettings.telegramChannelId) {
        (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
      }
      return;
    }

    const latestAudit = await prisma.auditLog.findFirst({
      where: { action: 'PLATFORM_SETTINGS_UPDATED', entityType: 'SETTINGS' },
      orderBy: { createdAt: 'desc' },
    });
    if (latestAudit && latestAudit.details && typeof latestAudit.details === 'object') {
      platformSettings = { ...platformSettings, ...(latestAudit.details as Record<string, unknown>) };
      if (platformSettings.telegramChannelId) {
        (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
      }
      await cache.set(CACHE_KEYS.PLATFORM_SETTINGS, JSON.stringify(platformSettings));
    }
  } catch {
    // Non-fatal, fallback to in-memory state
  }
}

void initPlatformSettings();
