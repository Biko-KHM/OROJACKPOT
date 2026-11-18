import React, { useEffect, useState } from 'react';
import {
  Trophy,
  ChevronRight,
  Hash,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Zap,
  ShieldCheck,
  Clock,
  X,
  Megaphone,
  PartyPopper,
  Lock,
} from 'lucide-react';
import { CampaignSummary } from '../types/index.js';
import { api } from '../api/client.js';
import { useLanguage } from '../context/LanguageContext.js';
import { CustomLoader } from './CustomLoader.js';
import { triggerHaptic } from '../utils/haptics.js';
import { ConfettiCanvas } from './ConfettiCanvas.js';

const CACHED_CAMPAIGNS_KEY = 'hiree_cached_campaigns';

const getInitialCachedCampaigns = (): CampaignSummary[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHED_CAMPAIGNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as CampaignSummary[];
      }
    }
  } catch {
    // ignore
  }
  return [];
};

interface CampaignListProps {
  onSelectCampaign: (campaign: CampaignSummary) => void;
}

export const CampaignList: React.FC<CampaignListProps> = ({ onSelectCampaign }) => {
  const { t } = useLanguage();
  const initialCached = getInitialCachedCampaigns();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>(initialCached);
  // Zero-wait startup: If cached campaigns exist, render immediately (isLoading = false)!
  const [isLoading, setIsLoading] = useState<boolean>(initialCached.length === 0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedComingSoon, setSelectedComingSoon] = useState<CampaignSummary | null>(null);
  const [confettiBurstKeys, setConfettiBurstKeys] = useState<Record<string, number>>({});
  const [myWinningNumbers, setMyWinningNumbers] = useState<Set<number>>(new Set());

  const fetchCampaigns = async (silent = false) => {
    if (!silent && campaigns.length === 0) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const data = await api.getOpenCampaigns();
      setCampaigns(data);
      try {
        localStorage.setItem(CACHED_CAMPAIGNS_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      if (campaigns.length === 0) {
        const msg = err instanceof Error ? err.message : 'Failed to load campaigns';
        setError(msg);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // If we have cached campaigns, fetch silently in background (0ms startup!)
    void fetchCampaigns(initialCached.length > 0);

    // Defer checking winning ticket numbers by 1200ms so initial campaign rendering is 100% unimpeded
    const timer = setTimeout(() => {
      void api
        .getMyConfirmedTickets()
        .then((reservations) => {
          const numbers = new Set<number>();
          reservations.forEach((r) => {
            r.items.forEach((item) => numbers.add(item.numberValueSnapshot));
          });
          setMyWinningNumbers(numbers);
        })
        .catch(() => {
          // Guest / unauthenticated fallback
        });
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  const triggerCelebration = (campaignId: string) => {
    triggerHaptic('success');
    setConfettiBurstKeys((prev) => ({
      ...prev,
      [campaignId]: (prev[campaignId] || 0) + 1,
    }));
  };

  const handleCampaignClick = (camp: CampaignSummary) => {
    if (camp.status === 'COMPLETED' || Boolean(camp.latestDraw)) {
      triggerCelebration(camp.id);
      return;
    }
    if (camp.status === 'CLOSED') {
      triggerHaptic('light');
      void fetchCampaigns();
      return;
    }
    if (camp.status === 'DRAFT') {
      triggerHaptic('light');
      setSelectedComingSoon(camp);
      return;
    }
    triggerHaptic('medium');
    onSelectCampaign(camp);
  };

  if (isLoading && campaigns.length === 0) {
    return <CustomLoader fullScreen={false} message="Loading active lotteries" />;
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto m-4 sm:m-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">{t('error')}</p>
          <p className="text-xs text-rose-300/80 mt-0.5">{error}</p>
          <button
            onClick={() => {
              triggerHaptic('light');
              void fetchCampaigns();
            }}
            className="mt-3 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-bold transition-colors active:scale-95"
          >
            {t('refreshAvailability')}
          </button>
        </div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="max-w-md mx-auto my-8 sm:my-12 p-6 sm:p-8 text-center rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400">
          <Sparkles className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-base font-bold text-slate-200">{t('openCampaigns')}</h3>
        <p className="text-xs text-slate-400 mt-1">{t('noActiveCampaigns')}</p>
        <button
          onClick={() => {
            triggerHaptic('light');
            void fetchCampaigns();
          }}
          className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 active:scale-95"
        >
          {t('refreshAvailability')}
        </button>
      </div>
    );
  }

  // Sort priority: OPEN (active buy) -> CLOSED (waiting for draw) -> COMPLETED (drawn winners) -> DRAFT (coming soon)
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const order: Record<string, number> = {
      OPEN: 1,
      CLOSED: 2,
      COMPLETED: 3,
      DRAFT: 4,
    };
    const orderA = order[a.status] || 5;
    const orderB = order[b.status] || 5;
    return orderA - orderB;
  });

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-5 space-y-4 sm:space-y-5 pb-safe-dock">
      {/* ------------------------------------------------------------------------ */}
      {/* Mobile Creative Hero Showcase Banner                                     */}
      {/* ------------------------------------------------------------------------ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0c251b] via-[#0e1724] to-[#121c2c] border border-[#1a2d24] p-4 sm:p-5 shadow-xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00d26a]/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-tr from-[#00d26a]/60 via-amber-400/40 to-[#00d26a]/50 shadow-lg shadow-[#00d26a]/20 shrink-0">
              <img
                src="/logo.png"
                alt="HIREE Lottery"
                loading="eager"
                decoding="async"
                width={56}
                height={56}
                className="w-full h-full object-cover rounded-[14px]"
              />
            </div>
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#00d26a]/15 border border-[#00d26a]/30 text-[#00d26a] text-xs font-black uppercase tracking-wider">
                <Zap className="w-3.5 h-3.5 text-[#00d26a] animate-bounce" />
                <span>Verified Ethiopian Draw</span>
              </div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight font-display">
                {t('openCampaigns')}
              </h2>
              <p className="text-xs text-fulus-muted font-medium">
                Pick your lucky tickets • Pay via CBE / Telebirr • Win grand prizes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 sm:pt-0 shrink-0">
            <span className="flex items-center gap-1 text-xs text-[#00d26a] font-bold bg-[#0c251b] px-2.5 py-1 rounded-xl border border-[#123c2a] shadow-sm select-none">
              <ShieldCheck className="w-3.5 h-3.5 text-[#00d26a]" />
              100% Trusted
            </span>
            <button
              onClick={() => {
                triggerHaptic('light');
                void fetchCampaigns();
              }}
              className="p-1.5 rounded-xl bg-[#0e131b] border border-[#1a2230] text-fulus-green hover:text-white transition-colors active:scale-95 text-xs font-semibold flex items-center gap-1"
              title="Refresh availability"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------------ */}
      {/* Campaign Cards List (Optimized for Mobile Touch)                        */}
      {/* ------------------------------------------------------------------------ */}
      <div className="space-y-3 sm:space-y-4">
        {sortedCampaigns.map((camp) => {
          const isDraft = camp.status === 'DRAFT';
          const isCompleted = camp.status === 'COMPLETED' || Boolean(camp.latestDraw);
          const isClosedWaiting = camp.status === 'CLOSED' && !camp.latestDraw;
          const priceEtb = (Number(camp.ticketPriceMinor) / 100).toFixed(2);
          const total = camp.numberEnd - camp.numberStart + 1;
          const sold = camp.reservedNumbers || 0;
          const percentage = Math.min(100, Math.round((sold / total) * 100));
          const hasWinningTicket = camp.latestDraw
            ? myWinningNumbers.has(camp.latestDraw.winningNumber)
            : false;
          const burstKey = confettiBurstKeys[camp.id] || 0;

          // ------------------------------------------------------------------
          // 1. CELEBRATORY WINNER DRAWN CARD (Confetti & Congratulations)
          // ------------------------------------------------------------------
          if (isCompleted) {
            return (
              <div
                key={camp.id}
                onClick={() => handleCampaignClick(camp)}
                className="ticket-stub p-4 sm:p-5 relative overflow-hidden bg-gradient-to-br from-[#1a1c12] via-[#0f1418] to-[#0c1a14] border border-amber-500/40 hover:border-amber-400/60 shadow-xl shadow-amber-500/5 group cursor-pointer transition-all duration-200 select-none"
              >
                {/* Floating Confetti Particle Shower */}
                <ConfettiCanvas
                  key={`confetti-${camp.id}-${burstKey}`}
                  active={true}
                  particleCount={60}
                />

                {/* Top Row: Golden Trophy + Winner Drawn Badge */}
                <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/30 border border-amber-500/40 flex items-center justify-center text-amber-300 shadow-md shadow-amber-500/20 shrink-0">
                      <Trophy className="w-6 h-6 text-amber-300 animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500/20 to-emerald-500/20 border border-amber-500/40 text-amber-300 text-xs font-black uppercase tracking-wider">
                          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                          <span>{t('winnerAnnounced')}</span>
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-extrabold text-white leading-tight truncate font-display mt-0.5">
                        {camp.prizeDescription}
                      </h3>
                      <p className="text-xs text-fulus-muted font-medium truncate">{camp.title}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 shadow-sm">
                      <span className="text-xs sm:text-sm font-black text-amber-300 font-mono">
                        COMPLETED
                      </span>
                    </div>
                  </div>
                </div>

                {/* Celebratory Congratulations Hero Display */}
                <div className="my-3 p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-[#0e1f18] to-emerald-500/15 border border-amber-500/30 text-center relative overflow-hidden z-10">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />

                  <span className="text-[11px] font-black uppercase tracking-widest text-amber-300 block mb-1">
                    🎉 {t('congratulationsWinner')} 🎉
                  </span>

                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#17140b] to-[#0c1f16] border border-amber-400/50 shadow-lg shadow-amber-500/20 my-1">
                    <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-xs text-amber-200/90 font-medium">Lucky Ticket</span>
                    <span className="text-lg sm:text-xl font-black text-amber-300 font-mono tracking-tight drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]">
                      #{camp.latestDraw?.winningNumber}
                    </span>
                  </div>

                  {camp.latestDraw?.prizeLabel && (
                    <p className="text-[11px] text-emerald-300/90 font-semibold mt-1">
                      Prize: {camp.latestDraw.prizeLabel}
                    </p>
                  )}

                  {hasWinningTicket && (
                    <div className="mt-2 text-xs font-black text-emerald-400 bg-emerald-500/20 py-1 px-3 rounded-lg border border-emerald-500/40 animate-bounce inline-block">
                      🌟 {t('youWonThisDraw')} 🌟
                    </div>
                  )}
                </div>

                {/* Perforated divider */}
                <div className="ticket-notch-divider" />

                {/* Bottom Row: 100% Trusted Badge & Celebrate Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1 relative z-10">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-fulus-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#00d26a] shrink-0" />
                    <span>Verified Random • 100% Fair</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerCelebration(camp.id);
                      }}
                      className="py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-sm"
                      title="Throw Confetti"
                    >
                      <PartyPopper className="w-3.5 h-3.5" />
                      <span>{t('throwConfetti')}</span>
                    </button>

                    <div
                      className="py-2 px-3.5 rounded-xl bg-[#0c251b] border border-[#123c2a] text-[#00d26a] text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm select-none cursor-default"
                      title="100% Trusted Cryptographic Draw"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#00d26a]" />
                      <span>100% Trusted</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // ------------------------------------------------------------------
          // 2. DRAW IN PROGRESS / WAITING FOR DRAW CARD
          // ------------------------------------------------------------------
          if (isClosedWaiting) {
            return (
              <div
                key={camp.id}
                onClick={() => handleCampaignClick(camp)}
                className="ticket-stub p-4 sm:p-5 relative overflow-hidden bg-gradient-to-br from-[#0c1822] via-[#0b131c] to-[#0d1c16] border border-cyan-500/30 hover:border-cyan-400/50 shadow-xl group cursor-pointer transition-all duration-200 select-none"
              >
                {/* Ambient Radar Scanner Pulse */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl animate-pulse pointer-events-none" />

                {/* Top Row: Clock/Lock Icon + Draw In Progress Badge */}
                <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md shadow-cyan-500/10 shrink-0">
                      <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 animate-spin [animation-duration:8s]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black uppercase tracking-wider animate-pulse">
                          <Lock className="w-3 h-3 text-cyan-400" />
                          <span>{t('drawInProgress')}</span>
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-extrabold text-white leading-tight truncate font-display mt-0.5">
                        {camp.prizeDescription}
                      </h3>
                      <p className="text-xs text-fulus-muted font-medium truncate">{camp.title}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="px-2.5 py-1 rounded-xl bg-cyan-500/10 border border-cyan-500/30 shadow-sm">
                      <span className="text-xs sm:text-sm font-black text-cyan-300 font-mono">
                        DRAWING
                      </span>
                    </div>
                  </div>
                </div>

                {/* Suspenseful Draw Waiting Box */}
                <div className="my-3 p-3.5 rounded-2xl bg-[#091219] border border-cyan-500/25 space-y-2 relative z-10">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-cyan-300/90 text-[11px] flex items-center gap-1.5 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
                      {t('drawInProgressSubtitle')}
                    </span>
                    <span className="text-cyan-400 font-bold text-[11px]">
                      {sold} tickets locked
                    </span>
                  </div>
                  <p className="text-[10px] text-fulus-muted leading-relaxed">
                    {t('drawSecurityNotice')}
                  </p>
                </div>

                {/* Perforated divider */}
                <div className="ticket-notch-divider" />

                {/* Bottom Row: Security Assurance & Check Results */}
                <div className="flex items-center justify-between gap-2 pt-1 relative z-10">
                  <span className="text-[10.5px] text-fulus-muted flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>Cryptographic Snapshot Locked</span>
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHaptic('light');
                      void fetchCampaigns();
                    }}
                    className="py-2 px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold flex items-center gap-1.5 transition-colors active:scale-95 shadow-sm"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Check Results</span>
                  </button>
                </div>
              </div>
            );
          }

          // ------------------------------------------------------------------
          // 3. DRAFT / OPEN TICKETING CAMPAIGN CARD
          // ------------------------------------------------------------------
          return (
            <div
              key={camp.id}
              onClick={() => handleCampaignClick(camp)}
              className={`ticket-stub p-4 sm:p-5 cursor-pointer transition-all duration-200 group active:scale-[0.99] select-none ${
                isDraft
                  ? 'border-amber-500/35 hover:border-amber-400/60 bg-gradient-to-br from-[#13151f] via-[#11131b] to-[#1a160c]'
                  : 'hover:border-fulus-green/50'
              }`}
            >
              {/* Top Row: Trophy Icon + Prize + Price */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  {camp.imageUrl ? (
                    <img
                      src={camp.imageUrl}
                      alt={camp.prizeDescription || camp.title}
                      loading="lazy"
                      decoding="async"
                      width={48}
                      height={48}
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl object-cover border shadow-sm shrink-0 transition-opacity duration-300 ${
                        isDraft
                          ? 'border-amber-500/30 shadow-amber-500/10 bg-[#1c180f]'
                          : 'border-[#123c2a] shadow-[#00d26a]/20 bg-[#0c251b]'
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                        isDraft
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-sm shadow-amber-500/10'
                          : 'fulus-icon-box-green shadow-sm shadow-[#00d26a]/20'
                      }`}
                    >
                      <Trophy className={`w-5 h-5 sm:w-6 sm:h-6 ${isDraft ? 'text-amber-400' : 'text-[#00d26a]'}`} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-extrabold text-white leading-tight truncate font-display">
                        {camp.prizeDescription}
                      </h3>
                      {isDraft && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black uppercase tracking-wider shrink-0 animate-pulse">
                          <Sparkles className="w-3 h-3 text-amber-300" />
                          <span>{t('comingSoonBadge')}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-fulus-muted font-medium mt-0.5 truncate">{camp.title}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`px-3 py-1.5 rounded-xl border shadow-sm ${
                      isDraft
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-[#0c251b] border-[#123c2a]'
                    }`}
                  >
                    <span
                      className={`text-sm sm:text-base font-black tracking-tight font-mono ${
                        isDraft ? 'text-amber-300' : 'text-fulus-green'
                      }`}
                    >
                      +{priceEtb}{' '}
                      <span className="text-xs font-semibold text-fulus-muted">ETB</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Middle Row: Progress Bar (OPEN) or Pre-Launch Notice (DRAFT) */}
              {isDraft ? (
                <div className="space-y-1.5 pt-1 mb-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-300/90 text-xs flex items-center gap-1.5 font-mono font-medium">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      {t('comingSoonSubtitle')}
                    </span>
                    <span className="text-amber-400 font-bold text-xs font-mono">
                      {total.toLocaleString()} tickets
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#1b1710] overflow-hidden border border-amber-500/20">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500/50 via-amber-400 to-amber-500/50 rounded-full animate-pulse"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 pt-1 mb-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fulus-dim text-xs flex items-center gap-1 font-mono font-medium">
                      <Hash className="w-3.5 h-3.5 text-[#00d26a]" />
                      {sold} / {total} tickets sold
                    </span>
                    <span className="text-fulus-green font-bold text-xs font-mono">
                      {percentage}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#151c27] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#00d26a] to-[#10b981] rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Perforated divider */}
              <div className="ticket-notch-divider" />

              {/* Bottom Row: Max limit & Thumb-friendly CTA */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1">
                <span className="text-xs text-fulus-muted flex items-center gap-1 font-medium">
                  <span>Max {camp.maxNumbersPerPurchase} tickets per buy</span>
                </span>

                {isDraft ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCampaignClick(camp);
                    }}
                    className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 transition-all"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>{t('comingSoon')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCampaignClick(camp);
                    }}
                    className="fulus-btn-primary w-full sm:w-auto py-2.5 px-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 shadow-md shadow-[#00d26a]/20"
                  >
                    <span>{t('viewCampaign')}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------------ */}
      {/* Coming Soon Interactive Preview Modal                                    */}
      {/* ------------------------------------------------------------------------ */}
      {selectedComingSoon && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => setSelectedComingSoon(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#191924] to-[#0f1118] border border-amber-500/30 p-5 shadow-2xl relative space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedComingSoon(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Modal Header */}
            <div className="text-center pt-2">
              {selectedComingSoon.imageUrl ? (
                <img
                  src={selectedComingSoon.imageUrl}
                  alt={selectedComingSoon.prizeDescription}
                  loading="lazy"
                  decoding="async"
                  width={64}
                  height={64}
                  className="w-16 h-16 mx-auto rounded-2xl object-cover border-2 border-amber-500/40 shadow-lg shadow-amber-500/20 mb-3"
                />
              ) : (
                <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border-2 border-amber-500/40 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/20 mb-3">
                  <Trophy className="w-8 h-8 text-amber-400" />
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black uppercase tracking-wider mb-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('comingSoonBadge')}</span>
              </div>
              <h3 className="text-lg font-black text-white">{selectedComingSoon.prizeDescription}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{selectedComingSoon.title}</p>
            </div>

            {/* Campaign Key Details */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">{t('ticketPrice')}</span>
                <span className="text-sm font-black text-amber-400 font-mono mt-0.5 block">
                  {(Number(selectedComingSoon.ticketPriceMinor) / 100).toFixed(2)} ETB
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">{t('numbersRange')}</span>
                <span className="text-sm font-black text-white font-mono mt-0.5 block">
                  #{selectedComingSoon.numberStart} – #{selectedComingSoon.numberEnd}
                </span>
              </div>
            </div>

            {/* Explanatory Message */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed flex items-start gap-2.5">
              <Megaphone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-300">{t('comingSoonModalTitle')}</p>
                <p className="text-[11px] text-amber-200/80 mt-1">{t('comingSoonModalDesc')}</p>
              </div>
            </div>

            {/* CTA Close Button */}
            <button
              onClick={() => setSelectedComingSoon(null)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 active:scale-98 transition-all"
            >
              {t('gotIt')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
