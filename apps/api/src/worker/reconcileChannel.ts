import { prisma } from '../db/index.js';
import { logger } from '../logger/index.js';
import { updateChannelProgressPost } from '../modules/telegram/service.js';
import { LotteryStatus } from '@prisma/client';

export interface ReconcileResult {
  checkedCount: number;
  updatedCount: number;
}

/**
 * Channel reconciliation worker: Automatic background channel editing is disabled
 * so that Telegram Channel posts are ONLY synchronized when the administrator explicitly
 * clicks the "Sync Channel" button on the campaign card.
 */
export async function reconcileChannelPosts(): Promise<ReconcileResult> {
  if (process.env.NODE_ENV !== 'test') {
    logger.debug('Channel reconciliation job skipped: synchronization is strictly controlled via manual "Sync Channel" action');
    return { checkedCount: 0, updatedCount: 0 };
  }

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

  return result;
}
