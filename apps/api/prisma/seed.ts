import { PrismaClient, UserRole, LotteryStatus, NumberStatus } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/modules/auth/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const superadminEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@orojackpot.com').toLowerCase().trim();
  const superadminPassword = process.env.INITIAL_SUPERADMIN_PASSWORD || 'OrojackpotAdmin2026!';
  const superadminTgId = BigInt(process.env.INITIAL_SUPERADMIN_TG_ID || process.env.SUPERADMIN_TELEGRAM_ID || '123456789');
  const seedSample = process.env.SEED_SAMPLE_DATA === 'true' || !isProd;

  console.log(`[Seed] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Seed] Initializing Superadmin account for: ${superadminEmail}`);

  // 1. Seed or update SUPERADMIN credentials
  const passwordHash = await hashPassword(superadminPassword);

  const superadminUser = await prisma.user.upsert({
    where: { telegramUserId: superadminTgId },
    update: {
      role: UserRole.SUPERADMIN,
      adminCredential: {
        upsert: {
          create: {
            email: superadminEmail,
            passwordHash,
            mustChangePassword: false,
          },
          update: {
            email: superadminEmail,
            passwordHash,
            failedAttempts: 0,
            lockedUntil: null,
            mustChangePassword: false,
          },
        },
      },
    },
    create: {
      telegramUserId: superadminTgId,
      username: 'superadmin',
      firstName: 'System',
      lastName: 'Superadmin',
      role: UserRole.SUPERADMIN,
      adminCredential: {
        create: {
          email: superadminEmail,
          passwordHash,
          mustChangePassword: false,
        },
      },
    },
  });

  console.log(`[Seed] Superadmin ready: ID ${superadminUser.id} (${superadminEmail})`);

  // 2. Optionally seed initial launch campaign for staging/development
  if (seedSample) {
    console.log('[Seed] Seeding sample inaugural launch campaign...');
    const sampleLottery = await prisma.lottery.upsert({
      where: { slug: 'grand-launch-draw' },
      update: {},
      create: {
        slug: 'grand-launch-draw',
        title: 'Grand Inaugural Launch Draw',
        description: 'Official inaugural draw for OROJACKPOT with 100 tickets.',
        prizeDescription: 'Brand new iPhone 16 Pro Max or 150,000 ETB cash prize',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: BigInt(5000), // 50 ETB in minor units (cents)
        numberStart: 1,
        numberEnd: 100,
        maxNumbersPerPurchase: 5,
        holdMinutes: 10,
        paymentInstructions: JSON.stringify({
          accounts: [
            {
              id: 'acc-cbe',
              type: 'bank',
              title: 'Commercial Bank of Ethiopia (CBE)',
              accountNumber: '1000 4892 1092 3',
              accountName: 'OROJACKPOT Official Lottery',
            },
            {
              id: 'acc-telebirr',
              type: 'telebirr',
              title: 'Telebirr SuperApp Transfer',
              accountNumber: '0911 23 45 67',
              accountName: 'OROJACKPOT Official Telebirr',
            },
          ],
          note: 'Please transfer the exact amount and upload your official bank or Telebirr SMS/receipt screenshot.',
        }),
        createdBy: superadminUser.id,
      },
    });

    const existingNumbersCount = await prisma.lotteryNumber.count({
      where: { lotteryId: sampleLottery.id },
    });

    if (existingNumbersCount === 0) {
      console.log('[Seed] Populating 100 tickets for sample campaign...');
      const numbersToInsert = [];
      for (let i = 1; i <= 100; i++) {
        numbersToInsert.push({
          lotteryId: sampleLottery.id,
          numberValue: i,
          status: NumberStatus.AVAILABLE,
        });
      }
      await prisma.lotteryNumber.createMany({ data: numbersToInsert });
      console.log('[Seed] Successfully populated 100 tickets (1 - 100).');
    }
  } else {
    console.log('[Seed] Production mode active: Skipped sample campaign generation. Database is clean for live operation.');
  }

  console.log('[Seed] Database initialization complete.');
}

main()
  .catch((e) => {
    console.error('[Seed Error] Failed to seed database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
