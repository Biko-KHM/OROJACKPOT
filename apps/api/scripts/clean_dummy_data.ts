import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

let dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('connection_limit')) {
  dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connection_limit=2&pool_timeout=30';
}

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

async function clean() {
  console.log('====================================================');
  console.log('       STARTING PRODUCTION DATA SANITIZATION        ');
  console.log('====================================================');

  // Specifically disable user-defined append-only triggers individually
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE draws DISABLE TRIGGER "draws_prevent_mutation";`);
    console.log('[TRIGGERS] Disabled draws_prevent_mutation');
  } catch (e: any) {
    console.log('[TRIGGERS] draws trigger note:', e.message || e);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs DISABLE TRIGGER "audit_logs_retention_mutation";`);
    console.log('[TRIGGERS] Disabled audit_logs_retention_mutation');
  } catch (e: any) {
    console.log('[TRIGGERS] audit_logs trigger note:', e.message || e);
  }

  try {
    // 1. Identify users to preserve
    const realUsers = await prisma.user.findMany({
      where: {
        OR: [
          { adminCredential: { email: 'admin@orojackpot.com' } },
          { telegramUserId: BigInt(1315281002) }, // Biko_KHM
          { telegramUserId: BigInt(6465017236) }, // bornsinner32
          { username: 'Biko_KHM' },
          { username: 'bornsinner32' },
        ],
      },
      select: { id: true, username: true, role: true, telegramUserId: true },
    });

    const preservedUserIds = new Set(realUsers.map((u) => u.id));
    console.log(
      `[PRESERVE] Preserved ${realUsers.length} legitimate users:`,
      realUsers.map((u) => `${u.username || 'admin'} (${u.role}, tg:${u.telegramUserId})`),
    );

    // 2. Identify Production Lottery (Abbaa Carraa)
    const allLotteries = await prisma.lottery.findMany({
      select: { id: true, title: true, slug: true, status: true },
    });
    console.log(`[INFO] Current lotteries count: ${allLotteries.length}`);

    const prodLottery = allLotteries.find((l) => l.slug === 'abbaa-carraa') || allLotteries[0];
    if (!prodLottery) {
      throw new Error('Fatal: No lottery found in database!');
    }
    console.log(
      `[PRESERVE] Production Lottery: "${prodLottery.title}" (slug: ${prodLottery.slug}, ID: ${prodLottery.id})`,
    );

    // 3. Remove all other test lotteries
    const testLotteries = allLotteries.filter((l) => l.id !== prodLottery.id);
    console.log(`[CLEANUP] Found ${testLotteries.length} dummy/test lotteries to remove.`);

    for (const tLot of testLotteries) {
      console.log(`  Deleting test lottery "${tLot.title}" (${tLot.slug})...`);
      await prisma.draw.deleteMany({ where: { lotteryId: tLot.id } });
      await prisma.drawCommitment.deleteMany({ where: { lotteryId: tLot.id } });
      await prisma.channelPost.deleteMany({ where: { lotteryId: tLot.id } });

      const resList = await prisma.reservation.findMany({
        where: { lotteryId: tLot.id },
        select: { id: true },
      });
      const resIds = resList.map((r) => r.id);
      if (resIds.length > 0) {
        const subList = await prisma.paymentSubmission.findMany({
          where: { reservationId: { in: resIds } },
          select: { id: true },
        });
        const subIds = subList.map((s) => s.id);
        if (subIds.length > 0) {
          await prisma.paymentReview.deleteMany({ where: { paymentSubmissionId: { in: subIds } } });
          await prisma.paymentSubmission.deleteMany({ where: { id: { in: subIds } } });
        }
        await prisma.refund.deleteMany({ where: { reservationId: { in: resIds } } });
        await prisma.numberClaim.deleteMany({ where: { reservationId: { in: resIds } } });
        await prisma.reservationItem.deleteMany({ where: { reservationId: { in: resIds } } });
        await prisma.reservation.deleteMany({ where: { id: { in: resIds } } });
      }

      await prisma.lotteryNumber.deleteMany({ where: { lotteryId: tLot.id } });
      await prisma.lottery.delete({ where: { id: tLot.id } });
    }

    // 4. In Production Campaign: Clean all test reservations and submissions
    console.log('[CLEANUP] Purging test reservations on production campaign...');
    const prodResList = await prisma.reservation.findMany({
      where: { lotteryId: prodLottery.id },
      select: { id: true },
    });
    const prodResIds = prodResList.map((r) => r.id);
    if (prodResIds.length > 0) {
      const prodSubList = await prisma.paymentSubmission.findMany({
        where: { reservationId: { in: prodResIds } },
        select: { id: true },
      });
      const prodSubIds = prodSubList.map((s) => s.id);
      if (prodSubIds.length > 0) {
        await prisma.paymentReview.deleteMany({ where: { paymentSubmissionId: { in: prodSubIds } } });
        await prisma.paymentSubmission.deleteMany({ where: { id: { in: prodSubIds } } });
      }
      await prisma.refund.deleteMany({ where: { reservationId: { in: prodResIds } } });
      await prisma.numberClaim.deleteMany({ where: { reservationId: { in: prodResIds } } });
      await prisma.reservationItem.deleteMany({ where: { reservationId: { in: prodResIds } } });
      await prisma.reservation.deleteMany({ where: { id: { in: prodResIds } } });
      console.log(`[CLEANUP] Deleted ${prodResIds.length} test reservations on production campaign.`);
    }

    // Reset ticket numbers to AVAILABLE
    const resetResult = await prisma.lotteryNumber.updateMany({
      where: { lotteryId: prodLottery.id },
      data: { status: 'AVAILABLE' },
    });
    console.log(`[RESET] Reset ${resetResult.count} lottery numbers to AVAILABLE.`);

    // 5. Delete all test users (preserving only legitimate users)
    console.log('[CLEANUP] Purging dummy test users...');
    const allUsers = await prisma.user.findMany({
      select: { id: true, username: true, role: true },
    });

    const testUserIds = allUsers
      .filter((u) => !preservedUserIds.has(u.id))
      .map((u) => u.id);

    if (testUserIds.length > 0) {
      await prisma.paymentReview.deleteMany({ where: { reviewerId: { in: testUserIds } } });
      await prisma.paymentSubmission.deleteMany({ where: { submittedBy: { in: testUserIds } } });
      await prisma.refund.deleteMany({ where: { handledBy: { in: testUserIds } } });
      await prisma.drawCommitment.deleteMany({ where: { committedBy: { in: testUserIds } } });
      await prisma.draw.deleteMany({ where: { runBy: { in: testUserIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: testUserIds } } });
      await prisma.reservation.deleteMany({ where: { userId: { in: testUserIds } } });
      await prisma.adminCredential.deleteMany({ where: { userId: { in: testUserIds } } });

      // Clean or reassign any audit logs referencing test users so user delete succeeds
      try {
        await prisma.$executeRawUnsafe(`UPDATE audit_logs SET actor_user_id = NULL WHERE actor_user_id IS NOT NULL;`);
      } catch {
        // ignore
      }

      const delUsers = await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      });
      console.log(`[CLEANUP] Deleted ${delUsers.count} test users.`);
    }

    // 6. Delete all outbox events
    const delOutbox = await prisma.outboxEvent.deleteMany({});
    console.log(`[CLEANUP] Cleared ${delOutbox.count} outbox events.`);

    // 7. Delete all notifications
    const delNotifications = await prisma.notification.deleteMany({});
    console.log(`[CLEANUP] Cleared ${delNotifications.count} notifications.`);

    // 8. Audit verification
    console.log('\n====================================================');
    console.log('       FINAL PRODUCTION DATABASE AUDIT REPORT       ');
    console.log('====================================================');
    const finalLotteries = await prisma.lottery.findMany({
      select: { id: true, title: true, slug: true, status: true },
    });
    const finalUsers = await prisma.user.findMany({
      select: { id: true, username: true, role: true, telegramUserId: true },
    });
    const finalReservations = await prisma.reservation.count();
    const finalSubmissions = await prisma.paymentSubmission.count();
    const finalReviews = await prisma.paymentReview.count();
    const finalOutbox = await prisma.outboxEvent.count();
    const finalNotifications = await prisma.notification.count();
    const availableNumbers = await prisma.lotteryNumber.count({
      where: { lotteryId: prodLottery.id, status: 'AVAILABLE' },
    });
    const totalNumbers = await prisma.lotteryNumber.count({
      where: { lotteryId: prodLottery.id },
    });

    console.log(`Lotteries count: ${finalLotteries.length}`);
    finalLotteries.forEach((l) => console.log(`  - [${l.status}] "${l.title}" (slug: ${l.slug})`));
    console.log(`Users count: ${finalUsers.length}`);
    finalUsers.forEach((u) => console.log(`  - [${u.role}] ${u.username || 'admin'} (tg: ${u.telegramUserId})`));
    console.log(`Reservations count: ${finalReservations}`);
    console.log(`Payment Submissions count: ${finalSubmissions}`);
    console.log(`Payment Reviews count: ${finalReviews}`);
    console.log(`Outbox Events count: ${finalOutbox}`);
    console.log(`Notifications count: ${finalNotifications}`);
    console.log(`Production Lottery Numbers: ${availableNumbers} / ${totalNumbers} AVAILABLE`);
    console.log('====================================================\n');
  } finally {
    try {
      console.log('[TRIGGERS] Re-enabling append-only triggers...');
      await prisma.$executeRawUnsafe(`ALTER TABLE draws ENABLE TRIGGER "draws_prevent_mutation";`);
      await prisma.$executeRawUnsafe(`ALTER TABLE payment_reviews ENABLE TRIGGER "payment_reviews_prevent_mutation";`);
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ENABLE TRIGGER "audit_logs_retention_mutation";`);
      console.log('[TRIGGERS] Triggers successfully re-enabled.');
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  }
}

clean().catch((err) => {
  console.error('[ERROR] Data cleanup failed:', err);
  process.exit(1);
});
