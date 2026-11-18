export const DEFAULT_HOLD_MINUTES = 10;
export const MAX_NUMBERS_PER_PURCHASE = 20;
export const MAX_CAMPAIGN_NUMBERS = 10000;
export const MAX_ACTIVE_AWAITING_PAYMENT = 3;
export const MAX_ACTIVE_PENDING_REVIEW = 5;
export const EVIDENCE_SIGNED_URL_EXPIRY_SECONDS = 300;
export const CUSTOMER_JWT_EXPIRY_SECONDS = 900;
export const CURRENCY_ETB = 'ETB' as const;

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  SUPERADMIN: 'SUPERADMIN',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LotteryStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type LotteryStatus = (typeof LotteryStatus)[keyof typeof LotteryStatus];

export const NumberStatus = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  PENDING_REVIEW: 'PENDING_REVIEW',
  RESERVED: 'RESERVED',
} as const;

export type NumberStatus = (typeof NumberStatus)[keyof typeof NumberStatus];

export const ReservationStatus = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const PaymentStatus = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ClaimStatus = {
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
} as const;

export type ClaimStatus = (typeof ClaimStatus)[keyof typeof ClaimStatus];
