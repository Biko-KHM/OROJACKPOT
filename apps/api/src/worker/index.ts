import { logger } from '../logger/index.js';
import { prisma } from '../db/index.js';
import { expireHolds } from './expireHolds.js';
import { processOutboxBatch } from './outboxProcessor.js';
import { reconcileChannelPosts } from './reconcileChannel.js';

const HOLD_EXPIRY_INTERVAL_MS = 30_000; // 30 seconds
const OUTBOX_PROCESS_INTERVAL_MS = 5_000; // 5 seconds
const RECONCILE_CHANNEL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const AUDIT_RETENTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let isHoldExpiryRunning = false;
let isOutboxRunning = false;
let isReconcileRunning = false;
let isAuditRetentionRunning = false;

/**
 * Runs one cycle of hold expiration.
 */
export async function runHoldExpiryCycle(): Promise<void> {
  if (isHoldExpiryRunning) {
    logger.debug('Hold expiry cycle skipped: previous cycle still active');
    return;
  }
  isHoldExpiryRunning = true;
  try {
    const result = await expireHolds();
    if (result.expiredCount > 0) {
      logger.info(
        {
          expiredReservations: result.expiredCount,
          releasedClaims: result.releasedClaimsCount,
        },
        'Hold expiry batch executed successfully',
      );
    }
  } catch (err) {
    logger.error({ err }, 'Error during hold expiry worker cycle');
  } finally {
    isHoldExpiryRunning = false;
  }
}

/**
 * Runs one cycle of outbox event processing.
 */
export async function runOutboxCycle(): Promise<void> {
  if (isOutboxRunning) {
    logger.debug('Outbox cycle skipped: previous cycle still active');
    return;
  }
  isOutboxRunning = true;
  try {
    const result = await processOutboxBatch();
    if (result.processed > 0 || result.failed > 0 || result.retried > 0) {
      logger.info(
        {
          processed: result.processed,
          failed: result.failed,
          retried: result.retried,
        },
        'Outbox batch executed',
      );
    }
  } catch (err) {
    logger.error({ err }, 'Error during outbox worker cycle');
  } finally {
    isOutboxRunning = false;
  }
}

/**
 * Runs one cycle of channel post reconciliation.
 */
export async function runReconcileCycle(): Promise<void> {
  if (isReconcileRunning) {
    logger.debug('Channel reconcile cycle skipped: previous cycle still active');
    return;
  }
  isReconcileRunning = true;
  try {
    await reconcileChannelPosts();
  } catch (err) {
    logger.error({ err }, 'Error during channel reconcile cycle');
  } finally {
    isReconcileRunning = false;
  }
}

/**
 * Runs one cycle of 7-day audit log retention pruning.
 */
export async function runAuditRetentionCycle(): Promise<void> {
  if (isAuditRetentionRunning) {
    logger.debug('Audit retention cycle skipped: previous cycle still active');
    return;
  }
  isAuditRetentionRunning = true;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: sevenDaysAgo } },
    });
    if (result.count > 0) {
      logger.info(
        {
          purgedLogsCount: result.count,
          cutoff: sevenDaysAgo.toISOString(),
        },
        '7-day audit log retention cycle purged expired records',
      );
    }
  } catch (err) {
    logger.error({ err }, 'Error during audit retention worker cycle');
  } finally {
    isAuditRetentionRunning = false;
  }
}

/**
 * Starts all worker background loops.
 */
export function startWorker(): () => void {
  logger.info(
    {
      holdExpiryIntervalMs: HOLD_EXPIRY_INTERVAL_MS,
      outboxIntervalMs: OUTBOX_PROCESS_INTERVAL_MS,
      reconcileIntervalMs: RECONCILE_CHANNEL_INTERVAL_MS,
      auditRetentionIntervalMs: AUDIT_RETENTION_INTERVAL_MS,
    },
    'All background workers started',
  );

  const holdExpiryTimer = setInterval(() => {
    void runHoldExpiryCycle();
  }, HOLD_EXPIRY_INTERVAL_MS);

  const outboxTimer = setInterval(() => {
    void runOutboxCycle();
  }, OUTBOX_PROCESS_INTERVAL_MS);

  const reconcileTimer = setInterval(() => {
    void runReconcileCycle();
  }, RECONCILE_CHANNEL_INTERVAL_MS);

  const auditRetentionTimer = setInterval(() => {
    void runAuditRetentionCycle();
  }, AUDIT_RETENTION_INTERVAL_MS);

  // Trigger immediate first run
  void runHoldExpiryCycle();
  void runOutboxCycle();
  void runAuditRetentionCycle();

  return () => {
    clearInterval(holdExpiryTimer);
    clearInterval(outboxTimer);
    clearInterval(reconcileTimer);
    clearInterval(auditRetentionTimer);
    logger.info('All background workers stopped');
  };
}

// Auto-start worker if executed directly as entrypoint
const isDirectExecution =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
    process.argv[1].endsWith('worker') ||
    process.argv[1].endsWith('index.ts'));

if (isDirectExecution) {
  startWorker();
}
