import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Hash,
  Key,
  Copy,
  Check,
  X,
  ExternalLink,
  Download,
  RefreshCw,
  Cpu,
  Award,
} from 'lucide-react';
import { verifyDrawProof, type VerificationResult } from '@tg-lottery/shared';
import { api } from '../api/client.js';
import { DrawVerificationData } from '../types/index.js';

interface DrawVerificationModalProps {
  drawId: string;
  onClose: () => void;
}

export const DrawVerificationModal: React.FC<DrawVerificationModalProps> = ({
  drawId,
  onClose,
}) => {
  const [data, setData] = useState<DrawVerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAndVerify() {
      setLoading(true);
      setError(null);
      try {
        const verifyData = await api.getDrawVerificationData(drawId);
        if (!isMounted) return;
        setData(verifyData);

        // Run independent client-side verification
        const result = await verifyDrawProof({
          algorithmVersion: verifyData.algorithmVersion,
          lotteryId: verifyData.lotteryId,
          drawOrder: verifyData.drawOrder,
          serverSeedCommitment: verifyData.serverSeedCommitment,
          serverSeedRevealed: verifyData.serverSeedRevealed,
          publicEntropy: verifyData.publicEntropy,
          snapshotHash: verifyData.snapshotHash,
          eligibleCount: verifyData.eligibleCount,
          winningIndex: verifyData.winningIndex,
        });

        if (isMounted) {
          setVerificationResult(result);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load draw verification');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadAndVerify();

    return () => {
      isMounted = false;
    };
  }, [drawId]);

  const copyToClipboard = (text: string, keyName: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadSnapshot = async () => {
    try {
      const snapshot = await api.getPublicDrawSnapshot(drawId);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hiree-draw-${drawId}-snapshot.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download snapshot');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm select-text"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draw-verify-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl p-5 sm:p-6 text-slate-200 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 id="draw-verify-title" className="text-base font-black text-white">
                Provably Fair Draw Verification
              </h3>
              <p className="text-xs text-slate-400">
                Independent cryptographic proof & audit verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="p-8 text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-slate-300">
              Executing independent browser verification...
            </p>
            <p className="text-xs text-slate-500">
              Computing SHA-256 seed commitments & HMAC-SHA256 rejection sampling
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Verification Status Card */}
        {data && verificationResult && (
          <>
            <div
              className={`p-4 rounded-2xl border flex items-center gap-3.5 ${
                verificationResult.isValid
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {verificationResult.isValid ? (
                <ShieldCheck className="w-7 h-7 text-emerald-400 shrink-0" />
              ) : (
                <ShieldAlert className="w-7 h-7 text-rose-400 shrink-0" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black tracking-wide">
                    {verificationResult.isValid
                      ? 'MATHEMATICALLY VERIFIED FAIR'
                      : 'VERIFICATION FAILED'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900 border border-slate-700">
                    {data.algorithmVersion}
                  </span>
                </div>
                <p className="text-xs opacity-90 mt-0.5">
                  {verificationResult.isValid
                    ? `Pre-draw commitment matches revealed seed. Calculated winning index #${verificationResult.calculatedWinningIndex} exactly equals drawn index #${data.winningIndex}.`
                    : verificationResult.errorMessage || 'Proof mismatch detected.'}
                </p>
              </div>
            </div>

            {/* Winner Badge */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex flex-col items-center justify-center text-slate-950 font-black shrink-0">
                  <span className="text-[9px] uppercase tracking-wider">TICKET</span>
                  <span className="text-xl font-mono leading-none">#{data.winningNumber}</span>
                </div>
                <div>
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5" /> {data.prizeLabel}
                  </span>
                  <p className="text-sm font-black text-white">{data.lotteryTitle}</p>
                </div>
              </div>
              <div className="text-right text-xs">
                <span className="text-slate-500 block text-[10px]">Candidate Pool</span>
                <span className="font-bold text-white font-mono">{data.eligibleCount} confirmed</span>
              </div>
            </div>

            {/* Cryptographic Parameters */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span>Cryptographic Proof Artifacts</span>
              </h4>

              {/* 1. Server Seed Commitment */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-bold flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-slate-500" />
                    1. Server Seed SHA-256 Commitment (Published Pre-Draw)
                  </span>
                  <button
                    onClick={() => copyToClipboard(data.serverSeedCommitment, 'commitment')}
                    className="p-1 hover:text-white"
                    title="Copy hash"
                  >
                    {copiedKey === 'commitment' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-300 break-all select-all">
                  {data.serverSeedCommitment}
                </p>
                <p className="text-[10px] text-slate-500">
                  SHA-256 hash committed to before entropy was finalized. Prevents operator cherry-picking.
                </p>
              </div>

              {/* 2. Revealed Server Seed */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-bold flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    2. Revealed Server Secret Seed (256-bit CSPRNG)
                  </span>
                  <button
                    onClick={() => copyToClipboard(data.serverSeedRevealed, 'seed')}
                    className="p-1 hover:text-white"
                    title="Copy seed"
                  >
                    {copiedKey === 'seed' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-amber-300 break-all select-all">
                  {data.serverSeedRevealed}
                </p>
                <p className="text-[10px] text-slate-500">
                  Verifiable via <code>SHA-256(revealedSeed) === Commitment</code> (
                  {verificationResult.commitmentMatches ? 'Matches ✓' : 'Mismatch ✗'})
                </p>
              </div>

              {/* 3. Snapshot SHA-256 Hash */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-bold flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-cyan-400" />
                    3. Frozen Eligible Snapshot Hash (SHA-256)
                  </span>
                  <button
                    onClick={() => copyToClipboard(data.snapshotHash, 'snapshot')}
                    className="p-1 hover:text-white"
                    title="Copy snapshot hash"
                  >
                    {copiedKey === 'snapshot' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-cyan-300 break-all select-all">
                  {data.snapshotHash}
                </p>
                <p className="text-[10px] text-slate-500">
                  Deterministic hash of sorted confirmed tickets. Guarantees no entries were added or removed.
                </p>
              </div>

              {/* 4. Public Entropy */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-bold flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                    4. Public Multi-Party Entropy / Client Beacon
                  </span>
                  <button
                    onClick={() => copyToClipboard(data.publicEntropy, 'entropy')}
                    className="p-1 hover:text-white"
                    title="Copy public entropy"
                  >
                    {copiedKey === 'entropy' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-purple-300 break-all select-all">
                  {data.publicEntropy}
                </p>
              </div>
            </div>

            {/* Actions: Download snapshot & Close */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleDownloadSnapshot}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Snapshot Audit JSON</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                Close Verification
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
