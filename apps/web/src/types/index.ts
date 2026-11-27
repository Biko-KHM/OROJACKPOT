export type NumberStatus = 'AVAILABLE' | 'HELD' | 'PENDING_REVIEW' | 'RESERVED';

export type ReservationStatus =
  | 'AWAITING_PAYMENT'
  | 'PENDING_REVIEW'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface CampaignSummary {
  id: string;
  slug: string;
  title: string;
  description?: string;
  prizeDescription: string;
  imageUrl?: string | null;
  drawVideoUrl?: string | null;
  drawLiveUrl?: string | null;
  ticketPriceMinor: string;
  numberStart: number;
  numberEnd: number;
  maxNumbersPerPurchase: number;
  holdMinutes: number;
  status: string;
  startsAt?: string;
  endsAt?: string;
  paymentInstructions?: string;
  totalNumbers: number;
  reservedNumbers: number;
  availableNumbers: number;
  latestDraw?: {
    id: string;
    prizeLabel: string;
    winningNumber: number;
    drawOrder?: number;
    drawVideoUrl?: string | null;
  drawLiveUrl?: string | null;
    createdAt: string;
  } | null;
}

export interface PaymentAccount {
  id: string;
  type: 'bank' | 'telebirr' | 'other';
  title: string;
  accountNumber: string;
  accountName: string;
}

export interface StructuredPaymentInstructions {
  accounts: PaymentAccount[];
  note?: string;
}

export interface NumbersSummaryRange {
  start: number;
  end: number;
  status: NumberStatus;
}

export interface NumbersSummaryResponse {
  lotteryId: string;
  totalNumbers: number;
  counts: {
    available: number;
    held: number;
    pendingReview: number;
    reserved: number;
  };
  ranges: NumbersSummaryRange[];
  cachedAt: string;
}

export interface ReservationItem {
  id: string;
  numberValueSnapshot: number;
  unitPriceMinor: string;
}

export interface ReservationDetails {
  id: string;
  publicReference: string;
  lotteryId: string;
  status: ReservationStatus;
  currency: string;
  unitPriceMinor: string;
  ticketCount: number;
  totalAmountMinor: string;
  holdExpiresAt?: string;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  items: ReservationItem[];
  lottery?: {
    id: string;
    title: string;
    slug: string;
    status?: string;
    prizeDescription: string;
    ticketPriceMinor?: string;
    holdMinutes?: number;
    paymentInstructions?: string;
    draws?: Array<{
      id: string;
      winningNumber: number;
      winningIndex?: number;
      prizeLabel: string;
      createdAt: string;
    }>;
  };
  paymentSubmissions?: Array<{
    id: string;
    status: string;
    claimedAmountMinor?: string;
    paymentReference?: string;
    reviews?: Array<{
      decision: string;
      reason?: string;
      createdAt: string;
    }>;
  }>;
}

export interface CustomerUser {
  id: string;
  telegramUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role: string;
  hasAdminCredential?: boolean;
  adminEmail?: string | null;
  mustChangePassword?: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN';
  telegramUserId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  mustChangePassword?: boolean;
}

export interface AdminTeamMember {
  id: string;
  role: 'SUPERADMIN' | 'ADMIN';
  actualRole?: string;
  isDeactivated?: boolean;
  heldRole?: 'SUPERADMIN' | 'ADMIN' | null;
  telegramUserId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isBlocked: boolean;
  email: string | null;
  lockedUntil: string | null;
  failedAttempts?: number;
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface AdminOverview {
  activeCampaignsCount: number;
  totalTicketsSold: number;
  totalRevenueMinor: string;
  pendingReviewsCount: number;
  failedOutboxCount: number;
  totalCustomersCount: number;
}

export interface AdminLottery {
  id: string;
  slug: string;
  title: string;
  description?: string;
  prizeDescription: string;
  imageUrl?: string | null;
  drawVideoUrl?: string | null;
  drawLiveUrl?: string | null;
  winningNumber?: number | null;
  latestDraw?: {
    id: string;
    drawnAt: string;
    winningNumber: number;
    prizeLabel?: string | null;
    drawVideoUrl?: string | null;
  drawLiveUrl?: string | null;
  } | null;
  ticketPriceMinor: string;
  numberStart: number;
  numberEnd: number;
  maxNumbersPerPurchase: number;
  holdMinutes: number;
  status: string;
  startsAt?: string;
  endsAt?: string;
  paymentInstructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSubmissionReviewItem {
  id: string;
  reservationId: string;
  submittedBy: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: string;
  fileSha256: string;
  claimedAmountMinor: string | null;
  paymentReference: string | null;
  status: string;
  createdAt: string;
  reservation: {
    id: string;
    publicReference: string;
    totalAmountMinor: string;
    ticketCount: number;
    status: string;
    lotteryId?: string;
    lotteryTitle: string;
    customerUsername: string | null;
    customerTelegramId: string;
  };
  reviews: Array<{
    id: string;
    reviewerId: string;
    decision: string;
    reason: string | null;
    comparedWithBankRecord: boolean;
    createdAt: string;
  }>;
}

export interface AdminReservationItem {
  id: string;
  publicReference: string;
  status: string;
  ticketCount: number;
  totalAmountMinor: string;
  holdExpiresAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  lottery: {
    title: string;
    slug: string;
  };
  user: {
    username: string | null;
    telegramUserId: string;
  };
  items: Array<{
    numberValue: number;
    lotteryNumberId: string;
  }>;
  paymentSubmissionsCount: number;
}

export interface AdminCustomerItem {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isBlocked: boolean;
  totalReservations: number;
  confirmedTickets: number;
  activeHolds: number;
  expiredReservations: number;
  totalSpentMinor: string;
  auditLogsCount?: number;
  lastActiveAt?: string | null;
  createdAt: string;
}

export interface CustomerDetailReservation {
  id: string;
  publicReference: string;
  status: string;
  ticketCount: number;
  totalAmountMinor: string;
  createdAt: string;
  holdExpiresAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  lottery: {
    id: string;
    title: string;
    slug: string;
    ticketPriceMinor: string;
  };
  items: Array<{ numberValue: number }>;
  paymentSubmission?: {
    id: string;
    status: string;
    paymentReference: string | null;
    claimedAmountMinor: string | null;
    createdAt: string;
  } | null;
}

export interface CustomerDetail {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
  stats: {
    totalReservations: number;
    confirmedTickets: number;
    activeHolds: number;
    expiredReservations: number;
    totalSpentMinor: string;
    wonDrawsCount: number;
  };
  reservations: CustomerDetailReservation[];
  auditLogs: AuditLogItem[];
  wonDraws: Array<{
    id: string;
    lotteryTitle: string;
    prizeLabel: string;
    winningNumber: number;
    createdAt: string;
  }>;
}

export interface FailedOutboxItem {
  id: string;
  eventType: string;
  payload: unknown;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  requestId: string | null;
  createdAt: string;
  actor: {
    userId: string | null;
    username: string | null;
    firstName?: string | null;
    lastName?: string | null;
    telegramUserId?: string | null;
    email: string | null;
    role: string | null;
    isSystem?: boolean;
  };
}

export interface NumberInventoryItem {
  id: string;
  numberValue: number;
  status: NumberStatus;
  activeClaim: {
    reservationReference: string;
    reservationStatus: string;
    customerUsername: string | null;
    customerTelegramId: string;
    heldUntil: string | null;
  } | null;
}

export interface PlatformSettings {
  dualApprovalRequired: boolean;
  dualApprovalThresholdMinor: string;
  reviewEscalationDelayMinutes: number;
  maintenanceMode: boolean;
  customerSupportTelegram: string;
  telegramChannelId?: string;
}

export interface TestChannelResult {
  ok: boolean;
  botUsername?: string;
  channelTitle?: string;
  channelUsername?: string | null;
  channelId?: string;
  chatType?: string;
  memberStatus?: string;
  canPost?: boolean;
  canEdit?: boolean;
  message?: string;
  error?: string;
}

export interface PurgeCampaignResult {
  ok: boolean;
  lotteryId: string;
  lotteryTitle: string;
  mode: 'ALL' | 'PENDING_ONLY';
  deletedSubmissionsCount: number;
  deletedReservationsCount: number;
  message: string;
}

export interface AdminDrawItem {
  id: string;
  lotteryId: string;
  lotteryTitle?: string;
  commitmentId?: string | null;
  prizeLabel: string;
  drawOrder?: number;
  eligibleCount: number;
  eligibleSetSha256: string;
  snapshotHash?: string;
  serverSeedCommitment?: string;
  serverSeedRevealed?: string;
  publicEntropy?: string;
  algorithmVersion?: string;
  randomSeed: string;
  winningNumber: number;
  winningIndex?: number;
  createdAt: string;
  verificationProof?: any;
  runner: {
    email: string;
    role: string;
  };
  winner: {
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    reservationReference: string;
  } | null;
}

export interface DrawCommitmentItem {
  id: string;
  lotteryId: string;
  prizeLabel: string;
  drawOrder: number;
  serverSeedCommitment: string;
  snapshotHash: string;
  eligibleCount: number;
  publicEntropySource: string;
  publicEntropy: string;
  status: 'COMMITTED' | 'EXECUTED' | 'CANCELLED';
  serverSecretSeed?: string;
  committedBy: string;
  committedAt: string;
  executedAt?: string;
}

export interface DrawVerificationData {
  drawId: string;
  lotteryId: string;
  lotteryTitle: string;
  prizeLabel: string;
  drawOrder: number;
  algorithmVersion: string;
  snapshotHash: string;
  eligibleCount: number;
  serverSeedCommitment: string;
  serverSeedRevealed: string;
  publicEntropy: string;
  winningIndex: number;
  winningNumber: number;
  rejectionAttempts: number;
  drawTimestamp: string;
  runnerRole: string;
  status: string;
}

export interface AdminRefundItem {
  id: string;
  reservationId: string;
  amountMinor: string;
  status: string;
  note: string | null;
  createdAt: string;
  reservationReference: string;
  lotteryTitle: string;
  customer: {
    username: string | null;
    telegramUserId: string;
    firstName: string | null;
  };
  handler: {
    email: string;
  } | null;
}


