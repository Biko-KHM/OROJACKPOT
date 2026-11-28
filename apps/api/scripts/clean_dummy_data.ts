import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/db/index.js';

async function clean() {
  console.log('====================================================');
  console.log('       STARTING PRODUCTION DATA SANITIZATION        ');
  console.log('====================================================');

  // 1. Identify Superadmin
  const adminCred = await prisma.adminCredential.findUnique({
    where: { email: 'admin@orojackpot.com' },
    include: { user: true },
  });
  if (!adminCred) {
    throw new Error('Fatal: admin@orojackpot.com not found in admin_credentials!');
  }
  const superadminUserId = adminCred.userId;
  console.log(`[PRESERVE] Superadmin: ${adminCred.email} (User ID: ${superadminUserId})`);

  // 2. Identify Production Lottery (Abbaa Carraa)
  const allLotteries = await prisma.lottery.findMany({
    select: { id: true, title: true, slug: true, status: true },
  });
  console.log(`[INFO] Current lotteries count: ${allLotteries.length}`);

  const prodLottery = allLotteries.find((l) => l.slug === 'abbaa-carraa') || allLotteries[0];
  if (!prodLottery) {
    throw new Error('Fatal: No lottery found to preserve as production lottery!');
  }
  console.log(`[PRESERVE] Production Lottery: "${prodLottery.title}" (slug: ${prodLottery.slug}, ID: ${prodLottery.id})`);

  // 3. Remove all other test lotteries
  const testLotteries = allLotteries.filter((l) => l.id !== prodLottery.id);
  console.log(`[CLEANUP] Found ${testLotteries.length} dummy/test lotteries to remove.`);

  for (const tLot of testLotteries) {
    console.log(`  Deleting test lottery "${tLot.title}" (${tLot.slug})...`);
    await prisma.drawCommitment.deleteMany({ where: { lotteryId: tLot.id } });
    await prisma.draw.deleteMany({ where: { lotteryId: tLot.id } });
    await prisma.channelPost.deleteMany({ where: { lotteryId: tLot.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: tLot.id } });

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
    console.log(`[CLEANUP] Deleted ${prodResIds.length} test reservations and all associated submissions/reviews.`);
  }

  // Reset ticket numbers to AVAILABLE
  const resetResult = await prisma.lotteryNumber.updateMany({
    where: { lotteryId: prodLottery.id },
    data: { status: 'AVAILABLE' },
  });
  console.log(`[RESET] Reset ${resetResult.count} lottery numbers to AVAILABLE.`);

  // 5. Delete all test users (preserving only Superadmin)
  console.log('[CLEANUP] Purging dummy test users...');
  const nonAdminUsers = await prisma.user.findMany({
    where: {
      id: { not: superadminUserId },
      role: { not: 'SUPERADMIN' },
    },
    select: { id: true, username: true },
  });
  const nonAdminIds = nonAdminUsers.map((u) => u.id);
  if (nonAdminIds.length > 0) {
    await prisma.paymentReview.deleteMany({ where: { reviewerId: { in: nonAdminIds } } });
    await prisma.paymentSubmission.deleteMany({ where: { submittedBy: { in: nonAdminIds } } });
    await prisma.refund.deleteMany({ where: { handledBy: { in: nonAdminIds } } });
    await prisma.drawCommitment.deleteMany({ where: { committedBy: { in: nonAdminIds } } });
    await prisma.draw.deleteMany({ where: { runBy: { in: nonAdminIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: nonAdminIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: nonAdminIds } } });

    const delUsers = await prisma.user.deleteMany({
      where: { id: { in: nonAdminIds } },
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
    select: { id: true, username: true, role: true },
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
  finalUsers.forEach((u) => console.log(`  - [${u.role}] ${u.username || 'admin'}`));
  console.log(`Reservations count: ${finalReservations}`);
  console.log(`Payment Submissions count: ${finalSubmissions}`);
  console.log(`Payment Reviews count: ${finalReviews}`);
  console.log(`Outbox Events count: ${finalOutbox}`);
  console.log(`Notifications count: ${finalNotifications}`);
  console.log(`Production Lottery Numbers: ${availableNumbers} / ${totalNumbers} AVAILABLE`);
  console.log('====================================================\n');

  await prisma.$disconnect();
}

clean().catch((err) => {
  console.error('[ERROR] Data cleanup failed:', err);
  process.exit(1);
});
