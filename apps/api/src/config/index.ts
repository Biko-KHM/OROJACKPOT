import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from root if not already set
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config(); // fallback to current working directory

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  S3_ENDPOINT: z.string().default('localhost'),
  S3_PORT: z.coerce.number().default(9000),
  S3_USE_SSL: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('payment-evidence'),
  S3_REGION: z.string().default('us-east-1'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ADMIN_SESSION_SECRET: z.string().min(32, 'ADMIN_SESSION_SECRET must be at least 32 characters'),
  TOTP_ENCRYPTION_KEY: z.string().min(32, 'TOTP_ENCRYPTION_KEY must be at least 32 characters'),

  TELEGRAM_BOT_TOKEN: z.string().default('dummy_bot_token'),
  TELEGRAM_WEBHOOK_SECRET: z.string().default('dummy_webhook_secret'),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().default(86400),
  REDIS_URL: z.string().optional(),

  // Supabase Storage
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('campaign-images'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const errorDetails = parsedEnv.error.format();
  console.error('Invalid environment variables configuration:', JSON.stringify(errorDetails, null, 2));
  throw new Error('Invalid environment variables. Check .env configuration.');
}

export const config = parsedEnv.data;
export type Config = z.infer<typeof envSchema>;
