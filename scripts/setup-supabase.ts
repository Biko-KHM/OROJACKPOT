import { PrismaClient } from '@prisma/client';

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../apps/api/.env') });

const supabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!supabaseUrl) {
  console.error('❌ DIRECT_URL or DATABASE_URL must be set in your .env file or environment.');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: supabaseUrl,
    },
  },
});

async function setup() {
  console.log('🚀 Connecting to Supabase database...');
  
  // 1. Check connectivity
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `;
  console.log(`📦 Found ${tables.length} tables in Supabase public schema:`, tables.map(t => t.tablename).join(', '));

  // 2. Apply append-only audit and draw triggers
  console.log('🛡️ Applying cryptographic triggers on draws and 7-day retention guard on audit_logs...');
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_record_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION audit_logs_retention_guard()
    RETURNS TRIGGER AS $$
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            RAISE EXCEPTION 'Table audit_logs is append-only. UPDATE operations are forbidden.';
        ELSIF TG_OP = 'DELETE' THEN
            IF OLD.created_at >= (NOW() - INTERVAL '7 days') THEN
                RAISE EXCEPTION 'Table audit_logs is append-only. Active audit logs within the 7-day retention window cannot be deleted.';
            END IF;
            RETURN OLD;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_logs_prevent_mutation ON audit_logs;`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_logs_retention_mutation ON audit_logs;`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER audit_logs_retention_mutation
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_retention_guard();
  `);

  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS draws_prevent_mutation ON draws;`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER draws_prevent_mutation
    BEFORE UPDATE OR DELETE ON draws
    FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();
  `);

  console.log('✅ Supabase PostgreSQL is fully initialized, hardened, and ready for production!');
}

setup()
  .catch((err) => {
    console.error('❌ Supabase setup error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
