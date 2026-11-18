import { z } from 'zod';
import { LotteryStatus, NumberStatus, ReservationStatus, UserRole } from '../constants/index.js';

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  timestamp: z.string(),
  uptime: z.number().optional(),
  database: z.enum(['connected', 'disconnected']).optional(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

export const UserRoleSchema = z.nativeEnum(UserRole);
export const LotteryStatusSchema = z.nativeEnum(LotteryStatus);
export const NumberStatusSchema = z.nativeEnum(NumberStatus);
export const ReservationStatusSchema = z.nativeEnum(ReservationStatus);

// Auth Schemas
export const TelegramAuthRequestSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
});
export type TelegramAuthRequest = z.infer<typeof TelegramAuthRequestSchema>;

export const TelegramAuthResponseSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.number(),
  user: z.object({
    id: z.string(),
    telegramUserId: z.string(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    role: UserRoleSchema,
  }),
});
export type TelegramAuthResponse = z.infer<typeof TelegramAuthResponseSchema>;

export const AdminLoginRequestSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminTotpRequestSchema = z.object({
  tempToken: z.string().min(1, 'tempToken is required'),
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});
export type AdminTotpRequest = z.infer<typeof AdminTotpRequestSchema>;

// Campaign (Lottery) Schemas
export const CreateLotteryRequestSchema = z.object({
  slug: z
    .string()
    .optional()
    .nullable()
    .transform((val) => {
      const raw = (val || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (raw.length >= 3) return raw.slice(0, 64);
      return `lottery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }),
  title: z.string().min(1, 'Title is required').max(128),
  description: z.string().max(5000).optional().nullable(),
  prizeDescription: z.string().min(1, 'Prize description is required').max(512),
  ticketPriceMinor: z.coerce.bigint().positive('Ticket price must be positive'),
  numberStart: z.coerce.number().int().min(0).default(0),
  numberEnd: z.coerce.number().int().min(0, 'numberEnd must be non-negative'),
  maxNumbersPerPurchase: z.coerce.number().int().min(1).max(100).default(20),
  holdMinutes: z.coerce.number().int().min(1).max(60).default(10),
  startsAt: z.union([z.string().datetime(), z.literal(''), z.null()]).optional().transform((v) => v || undefined),
  endsAt: z.union([z.string().datetime(), z.literal(''), z.null()]).optional().transform((v) => v || undefined),
  paymentInstructions: z.string().max(10000).optional().nullable(),
  imageUrl: z
    .string()
    .refine((val) => !val.startsWith('data:'), {
      message: 'Base64 image data is not allowed. Images must be stored in Supabase Storage.',
    })
    .optional()
    .nullable(),
}).refine((data) => data.numberEnd >= data.numberStart, {
  message: 'numberEnd must be greater than or equal to numberStart',
  path: ['numberEnd'],
}).refine((data) => (data.numberEnd - data.numberStart) < 10000, {
  message: 'Inventory limited to 10,000 numbers per campaign',
  path: ['numberEnd'],
});
export type CreateLotteryRequest = z.infer<typeof CreateLotteryRequestSchema>;

export const UpdateLotteryRequestSchema = z.object({
  title: z.string().min(1).max(128).optional(),
  description: z.string().max(5000).optional().nullable(),
  prizeDescription: z.string().min(1).max(512).optional(),
  ticketPriceMinor: z.coerce.bigint().positive().optional(),
  numberEnd: z.coerce.number().int().positive().optional(),
  maxNumbersPerPurchase: z.coerce.number().int().min(1).max(100).optional(),
  holdMinutes: z.coerce.number().int().min(1).max(60).optional(),
  startsAt: z.union([z.string().datetime(), z.literal(''), z.null()]).optional().transform((v) => v || undefined),
  endsAt: z.union([z.string().datetime(), z.literal(''), z.null()]).optional().transform((v) => v || undefined),
  paymentInstructions: z.string().max(10000).optional().nullable(),
  imageUrl: z
    .string()
    .refine((val) => !val.startsWith('data:'), {
      message: 'Base64 image data is not allowed. Images must be stored in Supabase Storage.',
    })
    .optional()
    .nullable(),
});
export type UpdateLotteryRequest = z.infer<typeof UpdateLotteryRequestSchema>;

export const NumberStatusRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
  status: NumberStatusSchema,
});
export type NumberStatusRange = z.infer<typeof NumberStatusRangeSchema>;

export const LotteryNumbersSummarySchema = z.object({
  lotteryId: z.string(),
  totalNumbers: z.number(),
  counts: z.record(z.string(), z.number()),
  ranges: z.array(NumberStatusRangeSchema),
  cachedAt: z.string(),
});
export type LotteryNumbersSummary = z.infer<typeof LotteryNumbersSummarySchema>;

// Reservation Schemas
export const CreateReservationRequestSchema = z.object({
  numbers: z.array(z.number().int().min(0)).min(1, 'Must select at least one number').max(20, 'Cannot exceed 20 numbers'),
  idempotencyKey: z.string().min(1).max(128),
});
export type CreateReservationRequest = z.infer<typeof CreateReservationRequestSchema>;

// Upload & Payment Submission Schemas
export const UploadProofRequestSchema = z.object({
  mimeType: z.string().min(1),
  originalFilename: z.string().min(1).max(255).optional(),
});
export type UploadProofRequest = z.infer<typeof UploadProofRequestSchema>;

export const UploadProofResponseSchema = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  expiresInSeconds: z.number(),
});
export type UploadProofResponse = z.infer<typeof UploadProofResponseSchema>;

export const CreatePaymentSubmissionRequestSchema = z.object({
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1).max(255),
  claimedAmountMinor: z.coerce.bigint().positive().optional(),
  paymentReference: z.string().max(128).optional(),
});
export type CreatePaymentSubmissionRequest = z.infer<typeof CreatePaymentSubmissionRequestSchema>;

// Admin Review Schemas
export const ApprovePaymentRequestSchema = z.object({
  comparedWithBankRecord: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm comparing against the bank record.' }),
  }),
  note: z.string().max(1000).optional(),
});
export type ApprovePaymentRequest = z.infer<typeof ApprovePaymentRequestSchema>;

export const RejectPaymentRequestSchema = z.object({
  reason: z.string().min(3, 'Rejection reason must be at least 3 characters').max(1000),
  comparedWithBankRecord: z.boolean().default(false),
});
export type RejectPaymentRequest = z.infer<typeof RejectPaymentRequestSchema>;

// Draw & Refund Schemas (Step 11 & Provably Fair Winner Engine)
export const ExecuteDrawRequestSchema = z.object({
  prizeLabel: z.string().min(1, 'Prize label is required').max(128),
  publicEntropy: z.string().max(256).optional(),
});
export type ExecuteDrawRequest = z.infer<typeof ExecuteDrawRequestSchema>;

export const CreateDrawCommitmentRequestSchema = z.object({
  prizeLabel: z.string().min(1, 'Prize label is required').max(128),
  drawOrder: z.coerce.number().int().min(1).default(1),
  publicEntropySource: z.enum(['MULTI_PARTY_CLIENT_SEED', 'DRAND_BEACON', 'BITCOIN_BLOCKHASH']).default('MULTI_PARTY_CLIENT_SEED'),
  customPublicEntropy: z.string().max(256).optional(),
});
export type CreateDrawCommitmentRequest = z.infer<typeof CreateDrawCommitmentRequestSchema>;

export const ExecuteCommittedDrawRequestSchema = z.object({
  publicEntropy: z.string().min(8, 'Public entropy must be at least 8 characters').max(256).optional(),
});
export type ExecuteCommittedDrawRequest = z.infer<typeof ExecuteCommittedDrawRequestSchema>;

export const MarkRefundPaidRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type MarkRefundPaidRequest = z.infer<typeof MarkRefundPaidRequestSchema>;



