import { prisma } from '../db/index.js';
import { logger } from '../logger/index.js';
import { updateChannelProgressPost } from '../modules/telegram/service.js';
import { LotteryStatus } from '@prisma/client';

export interface ReconcileResult {
  checkedCount: number;
  updatedCount: number;
}

/**
 * Reconciles active campaigns with the Telegram channel progress posts every 10 minutes.
 */
export async function reconcileChannelPosts(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checkedCount: 0,
    updatedCount: 0,
  };

  const activeLotteries = await prisma.lottery.findMany({
    where: {
      status: {
        in: [LotteryStatus.OPEN, LotteryStatus.PAUSED],
      },
    },
  });

  result.checkedCount = activeLotteries.length;

  for (const lottery of activeLotteries) {
    try {
      const updateResult = await updateChannelProgressPost(lottery.id, { force: true });
      if (updateResult.success) {
        result.updatedCount++;
      }
    } catch (err: unknown) {
      logger.warn({ err, lotteryId: lottery.id }, 'Channel reconciliation skipped for lottery');
    }
  }

  logger.info(
    { checked: result.checkedCount, updated: result.updatedCount },
    'Channel reconciliation job finished',
  );

  return result;
}
