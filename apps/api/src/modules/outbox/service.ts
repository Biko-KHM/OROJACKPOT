import { prisma } from '../../db/index.js';

export async function getFailedOutboxEvents(options?: {
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = Math.max(0, options?.offset ?? 0);

  const [total, items] = await Promise.all([
    prisma.outboxEvent.count({
      where: { status: 'FAILED' },
    }),
    prisma.outboxEvent.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
  ]);

  return {
    total,
    items,
    events: items,
    limit,
    offset,
  };
}

export async function retryFailedOutboxEvent(id: string) {
  const event = await prisma.outboxEvent.findUnique({
    where: { id },
  });

  if (!event) {
    throw new Error('Outbox event not found');
  }

  const updated = await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });

  return updated;
}
