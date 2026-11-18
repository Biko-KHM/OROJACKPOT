#!/usr/bin/env node
/**
 * HIREE — Independent Provably Fair Draw Verification Utility (CLI)
 * 
 * Usage:
 *   npx tsx scripts/verify-draw.ts <drawId> [apiBaseUrl]
 *   npx tsx scripts/verify-draw.ts --file <path-to-proof.json>
 * 
 * Algorithm: HIREE-VRF-v1.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  verifyDrawProof,
  sha256,
  serializeSnapshotEntries,
  HIREE_ALGORITHM_VERSION,
} from '../packages/shared/src/verifier.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
${BOLD}HIREE — Provably Fair Lottery Draw Verifier${RESET}
Algorithm: ${HIREE_ALGORITHM_VERSION}

${BOLD}USAGE:${RESET}
  npx tsx scripts/verify-draw.ts <drawId> [apiBaseUrl]
  npx tsx scripts/verify-draw.ts --file <path-to-proof.json>

${BOLD}EXAMPLES:${RESET}
  npx tsx scripts/verify-draw.ts d2834b2f-7679-4d69-a1b7-a859ba837265
  npx tsx scripts/verify-draw.ts d2834b2f-7679-4d69-a1b7-a859ba837265 http://localhost:3001
  npx tsx scripts/verify-draw.ts --file ./hiree-draw-snapshot.json
`);
    process.exit(0);
  }

  let verifyData: any;

  if (args[0] === '--file') {
    const filePath = args[1];
    if (!filePath) {
      console.error(`${RED}Error: File path required after --file${RESET}`);
      process.exit(1);
    }
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`${RED}Error: File not found: ${resolved}${RESET}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(resolved, 'utf-8');
    verifyData = JSON.parse(raw);
    if (verifyData.data) verifyData = verifyData.data;
  } else {
    const drawId = args[0];
    const baseUrl = args[1] || 'http://localhost:3005';
    const url = `${baseUrl.replace(/\/$/, '')}/draws/${drawId}/verify`;

    console.log(`${CYAN}Fetching draw proof from: ${url}...${RESET}`);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      verifyData = json.data;
    } catch (err) {
      console.error(`${RED}Failed to fetch draw verification data:${RESET}`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}           HIREE PROVABLY FAIR DRAW VERIFICATION REPORT         ${RESET}`);
  console.log(`${BOLD}================================================================${RESET}`);
  console.log(`Draw ID:               ${verifyData.drawId || 'N/A'}`);
  console.log(`Campaign ID:           ${verifyData.lotteryId || 'N/A'}`);
  console.log(`Campaign Title:        ${verifyData.lotteryTitle || 'N/A'}`);
  console.log(`Prize Label:           ${verifyData.prizeLabel || 'N/A'}`);
  console.log(`Draw Order:            #${verifyData.drawOrder || 1}`);
  console.log(`Algorithm Version:     ${verifyData.algorithmVersion || HIREE_ALGORITHM_VERSION}`);
  console.log(`Total Candidates:      ${verifyData.eligibleCount} confirmed tickets`);
  console.log(`Drawn Winning Ticket:  #${verifyData.winningNumber} (Index #${verifyData.winningIndex})`);
  console.log(`Execution Timestamp:   ${verifyData.drawTimestamp || verifyData.createdAt || 'N/A'}`);

  console.log(`\n${BOLD}--- 1. Cryptographic Parameters ---${RESET}`);
  console.log(`Pre-Draw Commitment:   ${verifyData.serverSeedCommitment}`);
  console.log(`Revealed Server Seed:  ${verifyData.serverSeedRevealed}`);
  console.log(`Snapshot SHA-256 Hash: ${verifyData.snapshotHash}`);
  console.log(`Public Entropy:        ${verifyData.publicEntropy}`);

  console.log(`\n${CYAN}Running mathematical verification...${RESET}`);

  const proof = await verifyDrawProof({
    algorithmVersion: verifyData.algorithmVersion,
    lotteryId: verifyData.lotteryId,
    drawOrder: verifyData.drawOrder,
    prizeIndex: (verifyData.drawOrder || 1) - 1,
    serverSeedCommitment: verifyData.serverSeedCommitment,
    serverSeedRevealed: verifyData.serverSeedRevealed,
    publicEntropy: verifyData.publicEntropy,
    snapshotHash: verifyData.snapshotHash,
    eligibleCount: verifyData.eligibleCount,
    winningIndex: verifyData.winningIndex,
    claimedWinningNumber: verifyData.winningNumber,
  });

  console.log(`\n${BOLD}--- 2. Verification Results ---${RESET}`);
  console.log(`Commitment Matches:    ${proof.commitmentMatches ? `${GREEN}PASS (Matches Revealed Seed)${RESET}` : `${RED}FAIL${RESET}`}`);
  console.log(`Snapshot Valid:        ${proof.snapshotHashValid ? `${GREEN}PASS (Integrity Verified)${RESET}` : `${RED}FAIL${RESET}`}`);
  console.log(`Derived Winning Index: #${proof.calculatedWinningIndex} ${proof.calculatedWinningIndex === verifyData.winningIndex ? `${GREEN}(Matches Recorded Index)${RESET}` : `${RED}MISMATCH${RESET}`}`);
  console.log(`Rejection Attempts:    ${proof.rejectionAttempts} sample(s)`);

  console.log(`\n${BOLD}================================================================${RESET}`);
  if (proof.isValid) {
    console.log(`${GREEN}${BOLD}✓ PROVABLY FAIR VERIFICATION SUCCESSFUL:${RESET}`);
    console.log(`${GREEN}  The winning ticket was generated with cryptographically committed${RESET}`);
    console.log(`${GREEN}  randomness. No administrator or player could have predicted or${RESET}`);
    console.log(`${GREEN}  manipulated the draw result.${RESET}`);
    console.log(`${BOLD}================================================================\n${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}✗ VERIFICATION FAILED:${RESET}`);
    console.log(`${RED}  ${proof.errorMessage || 'Proof mismatch detected.'}${RESET}`);
    console.log(`${BOLD}================================================================\n${RESET}`);
    process.exit(1);
  }
}

void main();
