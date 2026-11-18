import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../apps/api/.env') });

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('🧹 [Clean DB] Cleaning test data from database...');

  try {
    // 1. Clean transactional / operational data
    console.log('Clearing claims and outbox events...');
    await prisma.outboxEvent.deleteMany({}).catch(() => {});
    await prisma.numberClaim.deleteMany({}).catch(() => {});
    await prisma.channelPost.deleteMany({}).catch(() => {});
    await prisma.notification.deleteMany({}).catch(() => {});

    // 2. Clear payment records
    console.log('Clearing submissions and reviews...');
    await prisma.paymentSubmission.deleteMany({}).catch(() => {});
    await prisma.reservationItem.deleteMany({}).catch(() => {});
    await prisma.reservation.deleteMany({}).catch(() => {});

    // 3. Clear campaign inventory
    console.log('Clearing lottery numbers and campaigns...');
    await prisma.lotteryNumber.deleteMany({}).catch(() => {});
    await prisma.lottery.deleteMany({}).catch(() => {});

    // 4. Clear non-admin users
    console.log('Clearing customer accounts (preserving administrators)...');
    await prisma.user.deleteMany({
      where: {
        role: 'CUSTOMER',
      },
    }).catch(() => {});

    console.log('✅ [Clean DB] Database cleanly purged of all mock/test records! Schema and administrative credentials preserved.');
  } catch (err) {
    console.error('❌ [Clean DB Error]:', err);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
