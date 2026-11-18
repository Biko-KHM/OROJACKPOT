import crypto from 'node:crypto';
import { prisma } from '../../db/index.js';
import {
  LotteryStatus,
  ReservationStatus,
  UserRole,
  CommitmentStatus,
} from '@prisma/client';
import {
  HIREE_ALGORITHM_VERSION,
  EligibleSnapshotEntry,
  serializeSnapshotEntries,
  selectWinningIndexRejectionSampling,
  verifyDrawProof,
} from '@tg-lottery/shared';

export class DrawError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'DrawError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface PrepareDrawCommitmentParams {
  lotteryId: string;
  prizeLabel: string;
  drawOrder?: number;
  publicEntropySource?: string;
  customPublicEntropy?: string;
  adminUserId: string;
  adminRole: UserRole;
  requestId?: string;
}

export interface ExecuteCommittedDrawParams {
  commitmentId: string;
  publicEntropy?: string;
  adminUserId: string;
  adminRole: UserRole;
  requestId?: string;
}

export interface ExecuteDrawParams {
  lotteryId: string;
  prizeLabel: string;
  drawOrder?: number;
  adminUserId: string;
  adminRole: UserRole;
  requestId?: string;
  publicEntropy?: string;
}

function serializeCommitment(c: any, revealSecret = false) {
  return {
    id: c.id,
    lotteryId: c.lotteryId,
    prizeLabel: c.prizeLabel,
    drawOrder: c.drawOrder,
    serverSeedCommitment: c.serverSeedCommitment,
    snapshotHash: c.snapshotHash,
    eligibleCount: c.eligibleCount,
    publicEntropySource: c.publicEntropySource,
    publicEntropy: c.publicEntropy,
    serverSecretSeed: revealSecret ? c.serverSecretSeed : undefined,
    status: c.status,
    committedBy: c.committedBy,
    committedAt: c.committedAt.toISOString(),
    executedAt: c.executedAt ? c.executedAt.toISOString() : null,
  };
}

// --------------------------------------------------------------------------
// 1. PREPARE DRAW COMMITMENT (Pre-Draw Freeze & Provably Fair Commitment)
// --------------------------------------------------------------------------

export async function prepareDrawCommitment({
  lotteryId,
  prizeLabel,
  drawOrder = 1,
  publicEntropySource = 'MULTI_PARTY_CLIENT_SEED',
  customPublicEntropy,
  adminUserId,
  adminRole,
  requestId,
}: PrepareDrawCommitmentParams) {
  if (adminRole !== UserRole.SUPERADMIN) {
    throw new DrawError('FORBIDDEN', 'Only SUPERADMIN can prepare lottery draw commitments.', 403);
  }

  return prisma.$transaction(async (tx) => {
    // 1. Lock and verify campaign status
    const lottery = await tx.lottery.findUnique({
      where: { id: lotteryId },
    });

    if (!lottery) {
      throw new DrawError('NOT_FOUND', 'Lottery campaign not found.', 404);
    }

    if (lottery.status !== LotteryStatus.CLOSED && lottery.status !== LotteryStatus.COMPLETED) {
      throw new DrawError(
        'INVALID_STATE',
        `Draw commitment is refused unless the campaign is CLOSED. Current status is ${lottery.status}.`,
        409,
      );
    }

    // 2. Refuse second draw or duplicate active commitment for the same prize
    const existingDraw = await tx.draw.findFirst({
      where: { lotteryId, prizeLabel },
    });
    if (existingDraw) {
      throw new DrawError(
        'DRAW_ALREADY_EXISTS',
        `A draw for prize "${prizeLabel}" has already been executed for this campaign.`,
        409,
      );
    }

    const existingCommitment = await tx.drawCommitment.findFirst({
      where: { lotteryId, prizeLabel, status: CommitmentStatus.COMMITTED },
    });
    if (existingCommitment) {
      return serializeCommitment(existingCommitment, false);
    }

    // 3. Freeze eligible confirmed tickets
    const confirmedItems = await tx.reservationItem.findMany({
      where: {
        lotteryId,
        reservation: { status: ReservationStatus.CONFIRMED },
      },
      orderBy: { numberValueSnapshot: 'asc' },
      include: {
        reservation: {
          select: {
            id: true,
            publicReference: true,
            userId: true,
            createdAt: true,
          },
        },
      },
    });

    if (confirmedItems.length === 0) {
      throw new DrawError(
        'NO_ELIGIBLE_NUMBERS',
        'Cannot prepare draw: no confirmed ticket purchases exist for this campaign.',
        409,
      );
    }

    // 4. Create immutable deterministic snapshot entries
    const snapshotEntries: EligibleSnapshotEntry[] = confirmedItems.map((item) => ({
      numberValue: item.numberValueSnapshot,
      reservationRef: item.reservation.publicReference,
      userIdHash: crypto.createHash('sha256').update(item.reservation.userId).digest('hex'),
    }));

    const canonicalSnapshot = serializeSnapshotEntries(snapshotEntries);
    const snapshotHash = crypto.createHash('sha256').update(canonicalSnapshot).digest('hex');

    // 5. Generate cryptographically secure 32-byte secret seed & commitment
    const serverSecretSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedCommitment = crypto
      .createHash('sha256')
      .update(`${serverSecretSeed}:${lotteryId}:${snapshotHash}`)
      .digest('hex');

    // 6. Multi-party public entropy derivation
    const multiPartyDigest = crypto
      .createHash('sha256')
      .update(
        confirmedItems.map((i) => `${i.reservation.publicReference}:${i.reservation.createdAt.getTime()}`).join(';') +
          `:${lotteryId}:${prizeLabel}:${snapshotHash}`,
      )
      .digest('hex');

    const publicEntropy = customPublicEntropy?.trim() || multiPartyDigest;

    // 7. Insert DrawCommitment into database
    const commitment = await tx.drawCommitment.create({
      data: {
        lotteryId,
        prizeLabel,
        drawOrder,
        serverSeedCommitment,
        snapshotHash,
        eligibleCount: snapshotEntries.length,
        snapshotEntries: snapshotEntries as any,
        publicEntropySource,
        publicEntropy,
        serverSecretSeed,
        status: CommitmentStatus.COMMITTED,
        committedBy: adminUserId,
      },
      include: {
        committer: {
          select: {
            username: true,
            role: true,
            adminCredential: { select: { email: true } },
          },
        },
      },
    });

    // 8. Audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'DRAW_COMMITMENT_CREATED',
        entityType: 'DRAW',
        entityId: commitment.id,
        details: {
          lotteryId,
          prizeLabel,
          serverSeedCommitment,
          snapshotHash,
          eligibleCount: snapshotEntries.length,
          publicEntropySource,
        },
        requestId,
      },
    });

    return serializeCommitment(commitment, false);
  });
}

// --------------------------------------------------------------------------
// 2. EXECUTE DRAW FROM COMMITMENT (Unbiased VRF Rejection Sampling & Reveal)
// --------------------------------------------------------------------------

export async function executeDrawFromCommitment({
  commitmentId,
  publicEntropy: customPublicEntropy,
  adminUserId,
  adminRole,
  requestId,
}: ExecuteCommittedDrawParams) {
  if (adminRole !== UserRole.SUPERADMIN) {
    throw new DrawError('FORBIDDEN', 'Only SUPERADMIN can execute lottery draws.', 403);
  }

  return prisma.$transaction(async (tx) => {
    // 1. Lock and verify commitment
    const commitment = await tx.drawCommitment.findUnique({
      where: { id: commitmentId },
      include: { lottery: true },
    });

    if (!commitment) {
      throw new DrawError('NOT_FOUND', 'Draw commitment not found.', 404);
    }

    if (commitment.status !== CommitmentStatus.COMMITTED) {
      throw new DrawError(
        'INVALID_STATE',
        `Commitment has status ${commitment.status}. Only COMMITTED can be executed.`,
        409,
      );
    }

    const lotteryId = commitment.lotteryId;

    // 2. Prevent duplicate draws for the same prize
    const existingDraw = await tx.draw.findFirst({
      where: { lotteryId, prizeLabel: commitment.prizeLabel },
    });
    if (existingDraw) {
      throw new DrawError(
        'DRAW_ALREADY_EXISTS',
        `Draw for prize "${commitment.prizeLabel}" has already been executed.`,
        409,
      );
    }

    // 3. Load immutable snapshot entries from commitment
    const entries = commitment.snapshotEntries as unknown as EligibleSnapshotEntry[];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new DrawError('CORRUPTED_SNAPSHOT', 'Draw snapshot is empty or malformed.', 500);
    }

    // Verify snapshot hash matches recorded hash
    const canonical = serializeSnapshotEntries(entries);
    const computedSnapshotHash = crypto.createHash('sha256').update(canonical).digest('hex');
    if (computedSnapshotHash.toLowerCase() !== commitment.snapshotHash.toLowerCase()) {
      throw new DrawError('SNAPSHOT_HASH_MISMATCH', 'Eligible snapshot integrity verification failed.', 409);
    }

    // 4. Exclude tickets that have already won prior prizes in this lottery (prevent duplicate winners)
    const priorDraws = await tx.draw.findMany({
      where: { lotteryId },
      select: { winningNumber: true },
    });
    const priorWinningNumbers = new Set(priorDraws.map((d) => d.winningNumber));

    const eligibleCandidates = entries.filter((e) => !priorWinningNumbers.has(e.numberValue));
    if (eligibleCandidates.length === 0) {
      throw new DrawError('NO_ELIGIBLE_NUMBERS', 'No eligible remaining tickets for this prize.', 409);
    }

    // 5. Finalize public entropy and combined context
    const finalPublicEntropy =
      customPublicEntropy?.trim() || commitment.publicEntropy || crypto.randomBytes(16).toString('hex');
    const prizeIndex = commitment.drawOrder - 1;
    const context = `${commitment.snapshotHash}:${finalPublicEntropy}:${prizeIndex}`;

    // 6. Unbiased cryptographic rejection sampling
    const { index: winningIndex, attempts } = await selectWinningIndexRejectionSampling(
      commitment.serverSecretSeed,
      context,
      eligibleCandidates.length,
    );

    const winningEntry = eligibleCandidates[winningIndex];
    if (!winningEntry) {
      throw new DrawError('INTERNAL_ERROR', 'Failed to select winning ticket.', 500);
    }
    const winningNumber = winningEntry.numberValue;

    // 7. Find confirmed reservation details for the winner
    const winningItem = await tx.reservationItem.findFirst({
      where: {
        lotteryId,
        numberValueSnapshot: winningNumber,
        reservation: { status: ReservationStatus.CONFIRMED },
      },
      include: {
        reservation: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                telegramUserId: true,
              },
            },
          },
        },
      },
    });

    if (!winningItem) {
      throw new DrawError('WINNING_TICKET_NOT_FOUND', 'Could not locate reservation for winning ticket.', 500);
    }

    const verificationProof = {
      algorithmVersion: HIREE_ALGORITHM_VERSION,
      serverSeedCommitment: commitment.serverSeedCommitment,
      serverSeedRevealed: commitment.serverSecretSeed,
      publicEntropy: finalPublicEntropy,
      snapshotHash: commitment.snapshotHash,
      eligibleCount: eligibleCandidates.length,
      winningIndex,
      winningNumber,
      rejectionAttempts: attempts,
      executedAt: new Date().toISOString(),
    };

    // 8. Insert immutable Draw record
    const draw = await tx.draw.create({
      data: {
        lotteryId,
        commitmentId: commitment.id,
        prizeLabel: commitment.prizeLabel,
        drawOrder: commitment.drawOrder,
        eligibleCount: eligibleCandidates.length,
        eligibleSetSha256: commitment.snapshotHash,
        snapshotHash: commitment.snapshotHash,
        serverSeedCommitment: commitment.serverSeedCommitment,
        serverSeedRevealed: commitment.serverSecretSeed,
        publicEntropy: finalPublicEntropy,
        algorithmVersion: HIREE_ALGORITHM_VERSION,
        randomSeed: commitment.serverSecretSeed,
        winningNumber,
        winningIndex,
        verificationProof,
        runBy: adminUserId,
      },
      include: {
        runner: {
          select: {
            username: true,
            role: true,
            adminCredential: { select: { email: true } },
          },
        },
      },
    });

    // 9. Update commitment to EXECUTED and reveal secret seed
    await tx.drawCommitment.update({
      where: { id: commitment.id },
      data: {
        status: CommitmentStatus.EXECUTED,
        executedAt: new Date(),
        publicEntropy: finalPublicEntropy,
      },
    });

    // 10. Update Lottery status to COMPLETED
    await tx.lottery.update({
      where: { id: lotteryId },
      data: { status: LotteryStatus.COMPLETED },
    });

    // 11. Write immutable audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'DRAW_EXECUTED',
        entityType: 'DRAW',
        entityId: draw.id,
        details: {
          lotteryId,
          commitmentId: commitment.id,
          prizeLabel: commitment.prizeLabel,
          winningNumber,
          winningIndex,
          eligibleCount: eligibleCandidates.length,
          snapshotHash: commitment.snapshotHash,
          serverSeedCommitment: commitment.serverSeedCommitment,
          serverSeedRevealed: commitment.serverSecretSeed,
          publicEntropy: finalPublicEntropy,
          winnerTelegramUserId: winningItem.reservation.user.telegramUserId.toString(),
          reservationReference: winningItem.reservation.publicReference,
        },
        requestId,
      },
    });

    // 12. Enqueue Outbox Event for Bot & Channel
    await tx.outboxEvent.create({
      data: {
        eventType: 'DRAW_COMPLETED',
        payload: {
          drawId: draw.id,
          lotteryId,
          lotteryTitle: commitment.lottery.title,
          prizeLabel: commitment.prizeLabel,
          winningNumber,
          winnerTelegramUserId: winningItem.reservation.user.telegramUserId.toString(),
          winnerUsername: winningItem.reservation.user.username,
          reservationReference: winningItem.reservation.publicReference,
          eligibleCount: eligibleCandidates.length,
          snapshotHash: commitment.snapshotHash,
          serverSeedCommitment: commitment.serverSeedCommitment,
          serverSeedRevealed: commitment.serverSecretSeed,
          publicEntropy: finalPublicEntropy,
        },
      },
    });

    return {
      id: draw.id,
      lotteryId: draw.lotteryId,
      commitmentId: commitment.id,
      prizeLabel: draw.prizeLabel,
      drawOrder: draw.drawOrder,
      eligibleCount: draw.eligibleCount,
      eligibleSetSha256: draw.eligibleSetSha256,
      snapshotHash: draw.snapshotHash,
      serverSeedCommitment: draw.serverSeedCommitment,
      serverSeedRevealed: draw.serverSeedRevealed,
      publicEntropy: draw.publicEntropy,
      algorithmVersion: draw.algorithmVersion,
      randomSeed: draw.randomSeed,
      winningNumber: draw.winningNumber,
      winningIndex: draw.winningIndex,
      createdAt: draw.createdAt.toISOString(),
      runner: {
        email: draw.runner.adminCredential?.email || draw.runner.username,
        role: draw.runner.role,
      },
      winner: {
        telegramUserId: winningItem.reservation.user.telegramUserId.toString(),
        username: winningItem.reservation.user.username,
        firstName: winningItem.reservation.user.firstName,
        reservationReference: winningItem.reservation.publicReference,
      },
      verificationProof,
    };
  });
}

// --------------------------------------------------------------------------
// 3. BACKWARD-COMPATIBLE executeDraw (Atomic Commit & Execute Wrapper)
// --------------------------------------------------------------------------

export async function executeDraw({
  lotteryId,
  prizeLabel,
  drawOrder = 1,
  adminUserId,
  adminRole,
  requestId,
  publicEntropy,
}: ExecuteDrawParams) {
  // Check if an existing commitment is waiting
  const existingCommitment = await prisma.drawCommitment.findFirst({
    where: { lotteryId, prizeLabel, status: CommitmentStatus.COMMITTED },
  });

  if (existingCommitment) {
    return executeDrawFromCommitment({
      commitmentId: existingCommitment.id,
      publicEntropy,
      adminUserId,
      adminRole,
      requestId,
    });
  }

  // Otherwise, create commitment and immediately execute
  const commitment = await prepareDrawCommitment({
    lotteryId,
    prizeLabel,
    drawOrder,
    customPublicEntropy: publicEntropy,
    adminUserId,
    adminRole,
    requestId,
  });

  return executeDrawFromCommitment({
    commitmentId: commitment.id,
    publicEntropy,
    adminUserId,
    adminRole,
    requestId,
  });
}

// --------------------------------------------------------------------------
// 4. QUERY COMMITMENTS & DRAWS
// --------------------------------------------------------------------------

export async function getDrawCommitmentsByLottery(lotteryId: string) {
  const commitments = await prisma.drawCommitment.findMany({
    where: { lotteryId },
    orderBy: { committedAt: 'desc' },
  });

  return commitments.map((c) => serializeCommitment(c, c.status === CommitmentStatus.EXECUTED));
}

export async function getDrawsByLottery(lotteryId: string) {
  const draws = await prisma.draw.findMany({
    where: { lotteryId },
    include: {
      runner: {
        select: {
          username: true,
          role: true,
          adminCredential: { select: { email: true } },
        },
      },
      lottery: { select: { title: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(
    draws.map(async (d) => {
      const winningItem = await prisma.reservationItem.findFirst({
        where: {
          lotteryId: d.lotteryId,
          numberValueSnapshot: d.winningNumber,
          reservation: { status: ReservationStatus.CONFIRMED },
        },
        include: {
          reservation: {
            include: {
              user: { select: { username: true, telegramUserId: true, firstName: true } },
            },
          },
        },
      });

      return {
        id: d.id,
        lotteryId: d.lotteryId,
        lotteryTitle: d.lottery.title,
        commitmentId: d.commitmentId,
        prizeLabel: d.prizeLabel,
        drawOrder: d.drawOrder,
        eligibleCount: d.eligibleCount,
        eligibleSetSha256: d.eligibleSetSha256,
        snapshotHash: d.snapshotHash || d.eligibleSetSha256,
        serverSeedCommitment: d.serverSeedCommitment,
        serverSeedRevealed: d.serverSeedRevealed,
        publicEntropy: d.publicEntropy,
        algorithmVersion: d.algorithmVersion,
        randomSeed: d.randomSeed,
        winningNumber: d.winningNumber,
        winningIndex: d.winningIndex,
        createdAt: d.createdAt.toISOString(),
        runner: {
          email: d.runner.adminCredential?.email || d.runner.username,
          role: d.runner.role,
        },
        winner: winningItem
          ? {
              username: winningItem.reservation.user.username,
              telegramUserId: winningItem.reservation.user.telegramUserId.toString(),
              firstName: winningItem.reservation.user.firstName,
              reservationReference: winningItem.reservation.publicReference,
            }
          : null,
        verificationProof: d.verificationProof,
      };
    }),
  );
}

// --------------------------------------------------------------------------
// 5. PUBLIC TRANSPARENCY & VERIFICATION ENDPOINTS
// --------------------------------------------------------------------------

export async function getDrawVerificationData(drawId: string) {
  const draw = await prisma.draw.findUnique({
    where: { id: drawId },
    include: {
      lottery: { select: { id: true, title: true, slug: true } },
      commitment: true,
    },
  });

  if (!draw) {
    throw new DrawError('NOT_FOUND', 'Draw record not found.', 404);
  }

  // Retrieve anonymized snapshot numbers
  let snapshotNumbers: number[] = [];
  if (draw.commitment && Array.isArray(draw.commitment.snapshotEntries)) {
    const entries = draw.commitment.snapshotEntries as unknown as EligibleSnapshotEntry[];
    snapshotNumbers = entries.map((e) => e.numberValue).sort((a, b) => a - b);
  } else {
    const confirmedItems = await prisma.reservationItem.findMany({
      where: {
        lotteryId: draw.lotteryId,
        reservation: { status: ReservationStatus.CONFIRMED },
      },
      orderBy: { numberValueSnapshot: 'asc' },
      select: { numberValueSnapshot: true },
    });
    snapshotNumbers = confirmedItems.map((i) => i.numberValueSnapshot);
  }

  const proofResult = await verifyDrawProof({
    lotteryId: draw.lotteryId,
    prizeLabel: draw.prizeLabel,
    prizeIndex: (draw.drawOrder || 1) - 1,
    serverSecretSeed: draw.serverSeedRevealed || draw.randomSeed,
    serverSeedCommitment: draw.serverSeedCommitment || '',
    publicEntropy: draw.publicEntropy || '',
    snapshotHash: draw.snapshotHash || draw.eligibleSetSha256,
    eligibleTickets: snapshotNumbers,
    claimedWinningNumber: draw.winningNumber,
    algorithmVersion: draw.algorithmVersion,
  });

  return {
    drawId: draw.id,
    lotteryId: draw.lotteryId,
    lotteryTitle: draw.lottery.title,
    lotterySlug: draw.lottery.slug,
    prizeLabel: draw.prizeLabel,
    drawOrder: draw.drawOrder,
    algorithmVersion: draw.algorithmVersion,
    serverSeedCommitment: draw.serverSeedCommitment,
    serverSeedRevealed: draw.serverSeedRevealed,
    publicEntropy: draw.publicEntropy,
    snapshotHash: draw.snapshotHash || draw.eligibleSetSha256,
    eligibleCount: draw.eligibleCount,
    winningNumber: draw.winningNumber,
    winningIndex: draw.winningIndex,
    drawTimestamp: draw.createdAt.toISOString(),
    isVerified: proofResult.isValid,
    verificationProof: draw.verificationProof || proofResult,
    eligibleTicketsSample: snapshotNumbers.slice(0, 50),
    totalEligibleTickets: snapshotNumbers.length,
  };
}

export async function getPublicDrawSnapshot(drawId: string) {
  const draw = await prisma.draw.findUnique({
    where: { id: drawId },
    include: { commitment: true },
  });

  if (!draw) {
    throw new DrawError('NOT_FOUND', 'Draw record not found.', 404);
  }

  if (draw.commitment && Array.isArray(draw.commitment.snapshotEntries)) {
    const entries = draw.commitment.snapshotEntries as unknown as EligibleSnapshotEntry[];
    return {
      drawId: draw.id,
      snapshotHash: draw.snapshotHash,
      eligibleCount: entries.length,
      entries,
    };
  }

  const confirmedItems = await prisma.reservationItem.findMany({
    where: {
      lotteryId: draw.lotteryId,
      reservation: { status: ReservationStatus.CONFIRMED },
    },
    orderBy: { numberValueSnapshot: 'asc' },
    include: {
      reservation: { select: { publicReference: true, userId: true } },
    },
  });

  const entries: EligibleSnapshotEntry[] = confirmedItems.map((item) => ({
    numberValue: item.numberValueSnapshot,
    reservationRef: item.reservation.publicReference,
    userIdHash: crypto.createHash('sha256').update(item.reservation.userId).digest('hex'),
  }));

  return {
    drawId: draw.id,
    snapshotHash: draw.snapshotHash || draw.eligibleSetSha256,
    eligibleCount: entries.length,
    entries,
  };
}

// --------------------------------------------------------------------------
// 6. ANNOUNCE DRAW RESULT
// --------------------------------------------------------------------------

export async function announceDrawResult(
  drawId: string,
  adminUserId: string,
  adminRole: UserRole,
  requestId?: string,
) {
  if (adminRole !== UserRole.SUPERADMIN) {
    throw new DrawError('FORBIDDEN', 'Only SUPERADMIN can announce draw results to channel.', 403);
  }

  const draw = await prisma.draw.findUnique({
    where: { id: drawId },
    include: { lottery: true },
  });

  if (!draw) {
    throw new DrawError('NOT_FOUND', 'Draw record not found.', 404);
  }

  const winningItem = await prisma.reservationItem.findFirst({
    where: {
      lotteryId: draw.lotteryId,
      numberValueSnapshot: draw.winningNumber,
      reservation: { status: ReservationStatus.CONFIRMED },
    },
    include: {
      reservation: {
        include: {
          user: { select: { username: true, telegramUserId: true } },
        },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.outboxEvent.create({
      data: {
        eventType: 'PUBLISH_DRAW_RESULT_TO_CHANNEL',
        payload: {
          drawId: draw.id,
          lotteryId: draw.lotteryId,
          lotteryTitle: draw.lottery.title,
          prizeLabel: draw.prizeLabel,
          winningNumber: draw.winningNumber,
          eligibleCount: draw.eligibleCount,
          winnerTelegramUserId: winningItem?.reservation.user.telegramUserId.toString(),
          winnerUsername: winningItem?.reservation.user.username,
          serverSeedCommitment: draw.serverSeedCommitment,
          snapshotHash: draw.snapshotHash,
          algorithmVersion: draw.algorithmVersion,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'DRAW_RESULT_ANNOUNCED',
        entityType: 'DRAW',
        entityId: draw.id,
        details: {
          lotteryId: draw.lotteryId,
          prizeLabel: draw.prizeLabel,
          winningNumber: draw.winningNumber,
        },
        requestId,
      },
    });
  });

  return { success: true, message: 'Winner announcement scheduled for channel publication' };
}

// --------------------------------------------------------------------------
// 7. REFUNDS SERVICE (FR-29)
// --------------------------------------------------------------------------

export async function getRefunds(filter: {
  lotteryId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(filter.limit || 50, 100);
  const offset = filter.offset || 0;

  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where: {
        status: filter.status || undefined,
        ...(filter.lotteryId
          ? { reservation: { lotteryId: filter.lotteryId } }
          : {}),
      },
      include: {
        reservation: {
          include: {
            user: { select: { username: true, telegramUserId: true, firstName: true } },
            lottery: { select: { title: true, slug: true } },
          },
        },
        handler: {
          select: {
            username: true,
            adminCredential: { select: { email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.refund.count({
      where: {
        status: filter.status || undefined,
        ...(filter.lotteryId
          ? { reservation: { lotteryId: filter.lotteryId } }
          : {}),
      },
    }),
  ]);

  const serialized = refunds.map((r) => ({
    id: r.id,
    reservationId: r.reservationId,
    amountMinor: r.amountMinor.toString(),
    status: r.status,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    reservationReference: r.reservation.publicReference,
    lotteryTitle: r.reservation.lottery.title,
    customer: {
      username: r.reservation.user.username,
      telegramUserId: r.reservation.user.telegramUserId.toString(),
      firstName: r.reservation.user.firstName,
    },
    handler: r.handler
      ? {
          email: r.handler.adminCredential?.email || r.handler.username,
        }
      : null,
  }));

  return { refunds: serialized, total };
}

export async function markRefundPaid(params: {
  refundId: string;
  adminUserId: string;
  note?: string;
  requestId?: string;
}) {
  const refund = await prisma.refund.findUnique({
    where: { id: params.refundId },
  });

  if (!refund) {
    throw new DrawError('NOT_FOUND', 'Refund record not found.', 404);
  }

  if (refund.status === 'PAID') {
    throw new DrawError('ALREADY_PAID', 'This refund has already been marked as PAID.', 409);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.refund.update({
      where: { id: params.refundId },
      data: {
        status: 'PAID',
        handledBy: params.adminUserId,
        note: params.note || 'Manually refunded outside system via CBE/Telebirr',
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: params.adminUserId,
        action: 'REFUND_MARKED_PAID',
        entityType: 'REFUND',
        entityId: refund.id,
        details: {
          amountMinor: refund.amountMinor.toString(),
          reservationId: refund.reservationId,
          note: params.note,
        },
        requestId: params.requestId,
      },
    });

    return res;
  });

  return {
    id: updated.id,
    status: updated.status,
    amountMinor: updated.amountMinor.toString(),
    note: updated.note,
  };
}
