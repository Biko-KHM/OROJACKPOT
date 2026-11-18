import React, { useState, useEffect } from 'react';
import {
  Trophy,
  ShieldCheck,
  Hash,
  Send,
  AlertTriangle,
  CheckCircle,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Lock,
  FileCheck,
} from 'lucide-react';
import { AdminLottery, AdminDrawItem, AdminUser, DrawCommitmentItem } from '../../types/index.js';
import { api } from '../../api/client.js';
import { CustomLoader } from '../CustomLoader.js';
import { DrawVerificationModal } from '../DrawVerificationModal.js';

interface DrawsViewProps {
  currentAdmin: AdminUser;
}

export const DrawsView: React.FC<DrawsViewProps> = ({ currentAdmin }) => {
  const [lotteries, setLotteries] = useState<AdminLottery[]>([]);
  const [selectedLotteryId, setSelectedLotteryId] = useState<string>('');
  const [draws, setDraws] = useState<AdminDrawItem[]>([]);
  const [commitments, setCommitments] = useState<DrawCommitmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawsLoading, setDrawsLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [announcingId, setAnnouncingId] = useState<string | null>(null);
  const [activeModalDrawId, setActiveModalDrawId] = useState<string | null>(null);
  const [prizeLabel, setPrizeLabel] = useState('Grand Prize');
  const [customPublicEntropy, setCustomPublicEntropy] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isSuperadmin = currentAdmin.role === 'SUPERADMIN';

  // 1. Fetch campaigns on mount
  const fetchCampaigns = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdminLotteries();
      const list = Array.isArray(data) ? data : [];
      setLotteries(list);
      if (list.length > 0 && !selectedLotteryId) {
        const preferred =
          list.find((l) => l.status === 'CLOSED' || l.status === 'COMPLETED') || list[0];
        setSelectedLotteryId(preferred.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCampaigns();
  }, []);

  // 2. Fetch draws & commitments when selected campaign changes
  const fetchDrawsAndCommitments = async (lotteryId: string) => {
    if (!lotteryId) return;
    setDrawsLoading(true);
    setError(null);
    try {
      const [drawsData, commitmentsData] = await Promise.all([
        api.getLotteryDraws(lotteryId),
        api.getDrawCommitments(lotteryId).catch(() => []),
      ]);
      setDraws(Array.isArray(drawsData) ? drawsData : []);
      setCommitments(Array.isArray(commitmentsData) ? commitmentsData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load draws for campaign');
    } finally {
      setDrawsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedLotteryId) {
      void fetchDrawsAndCommitments(selectedLotteryId);
    }
  }, [selectedLotteryId]);

  const selectedLottery = Array.isArray(lotteries)
    ? lotteries.find((l) => l.id === selectedLotteryId)
    : undefined;

  // Active pending commitment for this prize
  const pendingCommitment = commitments.find(
    (c) => c.status === 'COMMITTED' && c.prizeLabel === prizeLabel.trim(),
  );

  // 3. Step 1: Prepare & Publish Draw Commitment
  const handlePrepareCommitment = async () => {
    if (!selectedLotteryId || !prizeLabel.trim() || !isSuperadmin) return;

    setCommitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const commitment = await api.prepareDrawCommitment(
        selectedLotteryId,
        prizeLabel.trim(),
        draws.length + 1,
        customPublicEntropy.trim() || undefined,
      );
      setSuccessMessage(
        `Pre-draw commitment created! Server Seed SHA-256: ${commitment.serverSeedCommitment.substring(
          0,
          16,
        )}... Snapshot frozen with ${commitment.eligibleCount} tickets.`,
      );
      await fetchDrawsAndCommitments(selectedLotteryId);
      await fetchCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draw commitment');
    } finally {
      setCommitting(false);
    }
  };

  // 4. Step 2: Reveal Seed & Execute Committed Draw
  const handleExecuteFromCommitment = async (commitmentId: string) => {
    if (!commitmentId || !isSuperadmin) return;

    if (
      !window.confirm(
        'Execute this committed draw? The secret seed will be revealed and winner deterministically calculated.',
      )
    ) {
      return;
    }

    setExecuting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const newDraw = await api.executeCommittedDraw(
        commitmentId,
        customPublicEntropy.trim() || undefined,
      );
      setSuccessMessage(
        `Winning ticket #${newDraw.winningNumber} drawn successfully for "${newDraw.prizeLabel}"!`,
      );
      await fetchDrawsAndCommitments(selectedLotteryId);
      await fetchCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute committed draw');
    } finally {
      setExecuting(false);
    }
  };

  // 5. Quick Atomic Draw (Step 1 + Step 2 in one flow)
  const handleAtomicDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLotteryId || !prizeLabel.trim() || !isSuperadmin) return;

    if (
      !window.confirm(
        `Are you sure you want to execute the cryptographic draw for "${prizeLabel}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setExecuting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const newDraw = await api.executeLotteryDraw(
        selectedLotteryId,
        prizeLabel.trim(),
        customPublicEntropy.trim() || undefined,
      );
      setSuccessMessage(
        `Winning ticket #${newDraw.winningNumber} drawn successfully for "${newDraw.prizeLabel}"!`,
      );
      await fetchDrawsAndCommitments(selectedLotteryId);
      await fetchCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute draw');
    } finally {
      setExecuting(false);
    }
  };

  // 6. Announce winner to channel
  const handleAnnounce = async (drawId: string) => {
    if (!isSuperadmin) return;
    setAnnouncingId(drawId);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.announceDraw(drawId);
      setSuccessMessage(
        res.message || 'Winner announcement successfully published to Telegram channel.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish announcement');
    } finally {
      setAnnouncingId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span>Cryptographic Draws & Winner Selection</span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Enterprise-grade SHA-256 commitment-reveal protocol, multi-party entropy, and unbiased rejection sampling.
          </p>
        </div>

        {/* Campaign Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="lottery-select" className="text-xs text-slate-400 font-bold whitespace-nowrap">
            Campaign:
          </label>
          <select
            id="lottery-select"
            value={selectedLotteryId}
            onChange={(e) => setSelectedLotteryId(e.target.value)}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 max-w-xs truncate"
          >
            {lotteries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({l.status})
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              void fetchCampaigns();
              if (selectedLotteryId) void fetchDrawsAndCommitments(selectedLotteryId);
            }}
            disabled={loading || drawsLoading}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading || drawsLoading ? 'animate-spin text-emerald-400' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {loading && lotteries.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading cryptographic draws"
          subtitle="Verifying campaigns and candidate draw pools"
        />
      ) : null}

      {/* Selected Campaign Status Banner */}
      {selectedLottery && (
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-amber-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-white">{selectedLottery.title}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    selectedLottery.status === 'CLOSED'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : selectedLottery.status === 'COMPLETED'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {selectedLottery.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Prize: <strong className="text-slate-200">{selectedLottery.prizeDescription}</strong> • Ticket Range:{' '}
                {selectedLottery.numberStart} - {selectedLottery.numberEnd}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-right">
              <span className="text-slate-400 block text-[11px]">Ticket Price</span>
              <span className="font-bold text-white font-mono">
                {(Number(selectedLottery.ticketPriceMinor) / 100).toFixed(2)} ETB
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[11px]">Drawn Prizes</span>
              <span className="font-bold text-amber-400 font-mono">{draws.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* Draw Execution Section (Requires CLOSED status) */}
      {selectedLottery?.status === 'CLOSED' ? (
        <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-amber-950/20 border border-amber-500/30 shadow-xl shadow-amber-500/5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-black text-white">Execute Prize Draw</h3>
            </div>
            {!isSuperadmin && (
              <span className="flex items-center gap-1 text-[11px] text-rose-400 font-bold bg-rose-500/10 px-2.5 py-1 rounded-xl border border-rose-500/20">
                <Lock className="w-3.5 h-3.5" /> SUPERADMIN Only
              </span>
            )}
          </div>

          {/* Prize Configuration */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">Prize Title / Label</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {['Grand Prize', '2nd Prize', '3rd Prize', 'Consolation Prize'].map((label) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => setPrizeLabel(label)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    prizeLabel === label
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={prizeLabel}
              onChange={(e) => setPrizeLabel(e.target.value)}
              placeholder="e.g. Grand Prize (100,000 ETB)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          {/* Optional External Public Entropy (e.g., Bitcoin / Ethereum Block Hash) */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">
              External Public Beacon / Block Hash (Optional)
            </label>
            <input
              type="text"
              value={customPublicEntropy}
              onChange={(e) => setCustomPublicEntropy(e.target.value)}
              placeholder="Leave blank for automatic multi-party client seed derivation"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              If omitted, public entropy is deterministically compiled from confirmed customer payment references, timestamps, and snapshot hashes.
            </p>
          </div>

          {/* Pending Commitment Card if one is waiting */}
          {pendingCommitment && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5 text-amber-300">
                  <FileCheck className="w-4 h-4 text-amber-400" />
                  Pre-Draw Commitment Waiting to be Executed
                </span>
                <span className="font-mono text-[10px] bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                  {pendingCommitment.prizeLabel}
                </span>
              </div>
              <p className="font-mono text-[11px] text-slate-300 break-all">
                Commitment: {pendingCommitment.serverSeedCommitment}
              </p>
              <p className="text-[11px] text-slate-400">
                Snapshot: {pendingCommitment.eligibleCount} tickets frozen at{' '}
                {new Date(pendingCommitment.committedAt).toLocaleTimeString()}
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => handleExecuteFromCommitment(pendingCommitment.id)}
                  disabled={executing || !isSuperadmin}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer disabled:opacity-50"
                >
                  {executing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Reveal Secret Seed & Execute Winner Selection</span>
                </button>
              </div>
            </div>
          )}

          {/* Integrity Guarantees */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-300 font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>Provably Fair Commitment Guarantees</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px] pl-1">
              <li>Deterministic ticket snapshot frozen and hashed (SHA-256) prior to draw.</li>
              <li>Server commits to a secret 256-bit seed (SHA-256) BEFORE entropy is known.</li>
              <li>Unbiased rejection sampling eliminates modulo bias across the ticket pool.</li>
              <li>Every participant can independently verify the published proof in browser or terminal.</li>
            </ul>
          </div>

          {/* Actions: Commit vs Instant Draw */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {!pendingCommitment && (
              <button
                type="button"
                onClick={handlePrepareCommitment}
                disabled={committing || executing || !isSuperadmin || !prizeLabel.trim()}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {committing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileCheck className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>1. Freeze Snapshot & Commit Draw</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleAtomicDraw}
              disabled={executing || committing || !isSuperadmin || !prizeLabel.trim()}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {executing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Executing Verifiable Draw...</span>
                </>
              ) : (
                <>
                  <Trophy className="w-4 h-4" />
                  <span>Execute Cryptographic Draw</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : selectedLottery && selectedLottery.status !== 'COMPLETED' ? (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-300 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="font-bold text-white">Campaign is not CLOSED for draw execution.</p>
              <p className="text-slate-400 mt-0.5">
                Campaign status is currently <strong className="text-amber-400">{selectedLottery.status}</strong>. Close ticket sales in the Campaigns tab before drawing winners.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Draws List / Winners History */}
      <div className="space-y-4">
        <h3 className="text-base font-black text-white flex items-center gap-2">
          <span>Executed Draws & Results</span>
          <span className="text-xs font-bold text-slate-400">({draws.length})</span>
        </h3>

        {drawsLoading ? (
          <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
            <span>Loading draw history...</span>
          </div>
        ) : draws.length === 0 ? (
          <div className="p-12 rounded-3xl bg-slate-900/50 border border-slate-800 text-center">
            <Trophy className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-300">No draws executed for this campaign yet.</p>
            <p className="text-xs text-slate-500 mt-1">
              When a campaign closes, SUPERADMINs can draw prizes here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {draws.map((d) => (
              <div
                key={d.id}
                className="p-5 sm:p-6 rounded-3xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all shadow-md relative overflow-hidden"
              >
                {/* Gold glowing accent */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  {/* Winning ticket card */}
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 flex flex-col items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20 shrink-0">
                      <span className="text-[10px] tracking-wider uppercase opacity-80">TICKET</span>
                      <span className="text-2xl font-mono leading-none">#{d.winningNumber}</span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-black text-white">{d.prizeLabel}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          CONFIRMED WINNER
                        </span>
                        {d.algorithmVersion && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            {d.algorithmVersion}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 text-xs text-slate-300 space-y-0.5">
                        <p>
                          Winner Telegram ID:{' '}
                          <span className="font-mono text-white font-bold">
                            {d.winner ? d.winner.telegramUserId : 'N/A'}
                          </span>
                          {d.winner?.username && (
                            <span className="text-slate-400"> (@{d.winner.username})</span>
                          )}
                        </p>
                        {d.winner?.reservationReference && (
                          <p className="text-slate-400 text-[11px]">
                            Reservation Ref:{' '}
                            <span className="font-mono text-slate-300 font-bold">
                              {d.winner.reservationReference}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Cryptographic Proof & Announce Button */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 lg:text-right">
                    <div className="space-y-1 text-xs text-slate-400">
                      <div>
                        Pool Size: <strong className="text-white">{d.eligibleCount} confirmed tickets</strong>
                      </div>
                      <div className="flex items-center gap-1.5 lg:justify-end">
                        <Hash className="w-3.5 h-3.5 text-slate-500" />
                        <span
                          className="text-[11px] font-mono text-slate-300 truncate max-w-[200px]"
                          title={d.snapshotHash || d.eligibleSetSha256}
                        >
                          {(d.snapshotHash || d.eligibleSetSha256).substring(0, 16)}...
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(d.snapshotHash || d.eligibleSetSha256)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                          title="Copy Snapshot SHA-256 Hash"
                        >
                          {copiedHash === (d.snapshotHash || d.eligibleSetSha256) ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Executed by {d.runner.email} • {new Date(d.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Verify Cryptographic Proof Button */}
                      <button
                        type="button"
                        onClick={() => setActiveModalDrawId(d.id)}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all shrink-0 cursor-pointer"
                        title="Open Provably Fair Verification Modal"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>Verify Proof</span>
                      </button>

                      {isSuperadmin && (
                        <button
                          type="button"
                          onClick={() => void handleAnnounce(d.id)}
                          disabled={announcingId === d.id}
                          className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-teal-600/20 transition-all shrink-0 cursor-pointer"
                          title="Broadcast winner announcement to Telegram channel"
                        >
                          {announcingId === d.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Announce to Channel</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provably Fair Verification Modal */}
      {activeModalDrawId && (
        <DrawVerificationModal
          drawId={activeModalDrawId}
          onClose={() => setActiveModalDrawId(null)}
        />
      )}
    </div>
  );
};
