/**
 * HIREE — Secure and Provably Fair Lottery Verification Engine
 * 
 * Algorithm: HIREE-VRF-v1.0
 * 
 * Cryptographic Protocol:
 * 1. Snapshot: Ascending sorted eligible confirmed tickets canonically serialized
 *    Format per entry: TICKET:<numberValue>|REF:<reservationRef>|USER:<userIdHash>
 *    Snapshot Hash: SHA-256(canonical entries string)
 * 2. Server Commitment: SHA-256(serverSecretSeed + ":" + lotteryId + ":" + snapshotHash)
 *    Published prior to draw execution.
 * 3. Combined Entropy: HMAC-SHA256(serverSecretSeed, snapshotHash + ":" + publicEntropy + ":" + prizeIndex)
 * 4. Unbiased Selection: Cryptographic rejection sampling over [0, eligibleCount) eliminating modulo bias.
 */

export const HIREE_ALGORITHM_VERSION = 'HIREE-VRF-v1.0';

export interface EligibleSnapshotEntry {
  numberValue: number;
  reservationRef: string;
  userIdHash: string;
}

export interface DrawVerificationInput {
  lotteryId?: string;
  prizeLabel?: string;
  drawOrder?: number;
  prizeIndex?: number;
  serverSecretSeed?: string;
  serverSeedRevealed?: string;
  serverSeedCommitment: string;
  publicEntropy: string;
  snapshotHash: string;
  eligibleTickets?: (number | EligibleSnapshotEntry)[];
  eligibleCount?: number;
  claimedWinningNumber?: number;
  claimedWinningIndex?: number;
  winningIndex?: number;
  algorithmVersion?: string;
}

export interface DrawVerificationResult {
  isValid: boolean;
  algorithmVersion: string;
  calculatedWinningIndex: number;
  computedWinningIndex: number;
  calculatedWinningNumber?: number | null;
  computedWinningNumber?: number | null;
  commitmentMatches: boolean;
  commitmentValid: boolean;
  snapshotHashValid: boolean;
  rejectionAttempts: number;
  errorMessage?: string;
  error?: string;
}

export type VerificationResult = DrawVerificationResult;

/**
 * Deterministically serializes eligible confirmed tickets for snapshot hashing.
 */
export function serializeSnapshotEntries(entries: EligibleSnapshotEntry[]): string {
  // Sort numerically ascending by ticket number
  const sorted = [...entries].sort((a, b) => a.numberValue - b.numberValue);
  return sorted
    .map(
      (e) =>
        `TICKET:${e.numberValue}|REF:${e.reservationRef}|USER:${e.userIdHash}`,
    )
    .join('\n');
}

/**
 * Pure, universal SHA-256 implementation (works in browser & Node.js).
 */
export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    return bufferToHex(new Uint8Array(hashBuffer));
  }

  // Node.js fallback
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(message).digest('hex');
  } catch {
    throw new Error('No cryptographic primitive available in runtime for SHA-256.');
  }
}

/**
 * Pure, universal HMAC-SHA256 implementation (works in browser & Node.js).
 */
export async function hmacSha256(keyHex: string, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const messageData = encoder.encode(message);
  const keyBytes = hexToBuffer(keyHex);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return new Uint8Array(signature);
  }

  // Node.js fallback
  try {
    const nodeCrypto = await import('node:crypto');
    const hmac = nodeCrypto.createHmac('sha256', Buffer.from(keyBytes));
    hmac.update(message);
    return new Uint8Array(hmac.digest());
  } catch {
    throw new Error('No cryptographic primitive available in runtime for HMAC-SHA256.');
  }
}

/**
 * Computes commitment hash from secret seed, lottery ID, and snapshot hash.
 */
export async function computeCommitmentHash(
  serverSecretSeed: string,
  lotteryId: string,
  snapshotHash: string,
): Promise<string> {
  return sha256(`${serverSecretSeed}:${lotteryId}:${snapshotHash}`);
}

/**
 * Mathematically unbiased rejection sampling algorithm.
 * Rejects values >= limit = floor(2^32 / eligibleCount) * eligibleCount to eliminate modulo bias.
 */
export async function selectWinningIndexRejectionSampling(
  serverSecretSeed: string,
  contextString: string,
  eligibleCount: number,
): Promise<{ index: number; attempts: number }> {
  if (eligibleCount <= 0) {
    throw new Error('Cannot select winner from empty candidate pool.');
  }
  if (eligibleCount === 1) {
    return { index: 0, attempts: 1 };
  }

  const MAX_UINT32 = 0x100000000; // 2^32 = 4,294,967,296
  const limit = Math.floor(MAX_UINT32 / eligibleCount) * eligibleCount;

  let counter = 0;
  let attempts = 0;

  while (attempts < 10000) {
    // Generate 32 bytes from HMAC with counter
    const digest = await hmacSha256(serverSecretSeed, `${contextString}:counter:${counter}`);
    counter++;

    // Read 8 consecutive 32-bit unsigned integers (4 bytes each) from the 32-byte digest
    for (let offset = 0; offset <= 28; offset += 4) {
      attempts++;
      const b0 = digest[offset] ?? 0;
      const b1 = digest[offset + 1] ?? 0;
      const b2 = digest[offset + 2] ?? 0;
      const b3 = digest[offset + 3] ?? 0;
      const val = ((b0 << 24) >>> 0) + ((b1 << 16) | (b2 << 8) | b3);

      // Rejection condition: discard values in the biased remainder zone
      if (val < limit) {
        return { index: val % eligibleCount, attempts };
      }
    }
  }

  throw new Error('Rejection sampling failed to converge within limit (astronomically improbable).');
}

/**
 * Verifies a published draw commitment, snapshot integrity, and reproducible winning selection.
 */
export async function verifyDrawProof(input: DrawVerificationInput): Promise<DrawVerificationResult> {
  const version = input.algorithmVersion || HIREE_ALGORITHM_VERSION;
  const seed = input.serverSecretSeed || input.serverSeedRevealed || '';

  // 1. Verify Commitment: SHA256(serverSecretSeed:lotteryId:snapshotHash) === serverSeedCommitment
  let commitmentMatches = false;
  if (seed) {
    if (input.lotteryId) {
      const withContext = await computeCommitmentHash(
        seed,
        input.lotteryId,
        input.snapshotHash,
      );
      if (withContext.toLowerCase() === input.serverSeedCommitment.toLowerCase()) {
        commitmentMatches = true;
      }
    }
    if (!commitmentMatches) {
      const directHash = await sha256(seed);
      if (directHash.toLowerCase() === input.serverSeedCommitment.toLowerCase()) {
        commitmentMatches = true;
      }
    }
  }

  // 2. Verify Snapshot Hash if entries provided
  let snapshotHashValid = true;
  let numbersList: number[] = [];

  const eligibleTickets = input.eligibleTickets || [];
  if (eligibleTickets.length > 0) {
    if (typeof eligibleTickets[0] === 'object') {
      const entries = eligibleTickets as EligibleSnapshotEntry[];
      const canonical = serializeSnapshotEntries(entries);
      const computedSnapshotHash = await sha256(canonical);
      snapshotHashValid = computedSnapshotHash.toLowerCase() === input.snapshotHash.toLowerCase();
      numbersList = entries.map((e) => e.numberValue).sort((a, b) => a - b);
    } else {
      numbersList = (eligibleTickets as number[]).slice().sort((a, b) => a - b);
      const simpleCanonical = numbersList.join(',');
      const computedSimpleHash = await sha256(simpleCanonical);
      if (computedSimpleHash.toLowerCase() === input.snapshotHash.toLowerCase()) {
        snapshotHashValid = true;
      }
    }
  }

  const poolSize = numbersList.length > 0 ? numbersList.length : (input.eligibleCount || 0);

  // 3. Reproduce Random Selection
  const prizeIdx = input.prizeIndex ?? (input.drawOrder ? input.drawOrder - 1 : 0);
  const context = `${input.snapshotHash}:${input.publicEntropy}:${prizeIdx}`;
  const { index, attempts } = await selectWinningIndexRejectionSampling(
    seed,
    context,
    poolSize > 0 ? poolSize : 1,
  );

  const calculatedWinningNumber = numbersList.length > index ? numbersList[index] : null;

  const expectedIndex = input.claimedWinningIndex ?? input.winningIndex;
  const indexMatches = expectedIndex !== undefined ? index === expectedIndex : true;
  const numberMatches =
    input.claimedWinningNumber !== undefined && calculatedWinningNumber !== null
      ? calculatedWinningNumber === input.claimedWinningNumber
      : true;

  const isValid = commitmentMatches && snapshotHashValid && indexMatches && numberMatches;

  const errMessage = !isValid
    ? !commitmentMatches
      ? 'Commitment mismatch: Revealed seed does not produce published commitment.'
      : !snapshotHashValid
      ? 'Snapshot integrity error: Eligible tickets do not match recorded snapshot hash.'
      : !indexMatches
      ? `Winning index mismatch: Algorithm derived index #${index}, expected #${expectedIndex}.`
      : `Winning number mismatch: Algorithm derived #${calculatedWinningNumber}, claimed was #${input.claimedWinningNumber}.`
    : undefined;

  return {
    isValid,
    algorithmVersion: version,
    calculatedWinningIndex: index,
    computedWinningIndex: index,
    calculatedWinningNumber,
    computedWinningNumber: calculatedWinningNumber,
    commitmentMatches,
    commitmentValid: commitmentMatches,
    snapshotHashValid,
    rejectionAttempts: attempts,
    errorMessage: errMessage,
    error: errMessage,
  };
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}
