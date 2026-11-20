import React, { useEffect, useState } from 'react';
import { Ticket, Trophy, Calendar, RefreshCw, AlertCircle, Sparkles, Copy, Check, ShieldCheck } from 'lucide-react';
import { ReservationDetails } from '../types/index.js';
import { api } from '../api/client.js';
import { useLanguage } from '../context/LanguageContext.js';
import { CustomLoader } from './CustomLoader.js';
import { triggerHaptic } from '../utils/haptics.js';

const CACHED_TICKETS_KEY = 'orojackpot_cached_tickets';

const getInitialCachedTickets = (): ReservationDetails[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHED_TICKETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ReservationDetails[];
      }
    }
  } catch {
    // ignore
  }
  return [];
};

interface TicketHistoryProps {
  onExploreCampaigns?: () => void;
}

const PAGE_SIZE = 15;

export const TicketHistory: React.FC<TicketHistoryProps> = ({ onExploreCampaigns }) => {
  const { t } = useLanguage();
  const initialCached = getInitialCachedTickets();
  const [tickets, setTickets] = useState<ReservationDetails[]>(initialCached);
  const [isLoading, setIsLoading] = useState<boolean>(initialCached.length === 0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(initialCached.length >= PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  const fetchTickets = async (silent = false) => {
    if (!silent && tickets.length === 0) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const data = await api.getMyConfirmedTickets({ limit: PAGE_SIZE, offset: 0 });
      const list = Array.isArray(data) ? data : [];
      setTickets(list);
      setHasMore(list.length === PAGE_SIZE);
      try {
        localStorage.setItem(CACHED_TICKETS_KEY, JSON.stringify(list));
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      if (tickets.length === 0) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch tickets';
        setError(msg);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    triggerHaptic('selection');
    try {
      const nextBatch = await api.getMyConfirmedTickets({
        limit: PAGE_SIZE,
        offset: tickets.length,
      });
      const list = Array.isArray(nextBatch) ? nextBatch : [];
      if (list.length > 0) {
        setTickets((prev) => [...prev, ...list]);
        setHasMore(list.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.warn('Failed to load more tickets:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchTickets(initialCached.length > 0);
  }, []);

  const handleCopy = async (ref: string) => {
    triggerHaptic('success');
    try {
      await navigator.clipboard.writeText(ref);
      setCopiedRef(ref);
      setTimeout(() => setCopiedRef(null), 2000);
    } catch {
      setCopiedRef(ref);
      setTimeout(() => setCopiedRef(null), 2000);
    }
  };

  if (isLoading) {
    return <CustomLoader fullScreen={false} message="Loading your tickets" subtitle="Checking confirmed entries" />;
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto m-4 sm:m-6 p-4 sm:p-5 rounded-2xl bg-[#0e131b] border border-rose-500/30 text-rose-300 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-bold text-white">{t('error')}</p>
            <p className="text-rose-300/80 mt-1">{error}</p>
          </div>
        </div>
        <button
          onClick={() => {
            triggerHaptic('light');
            void fetchTickets();
          }}
          className="w-full py-2.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors active:scale-95"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t('tryAgain')}</span>
        </button>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="max-w-md mx-auto my-8 p-6 sm:p-8 text-center fulus-card space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#131923] border border-[#1a2230] flex items-center justify-center text-[#94a3b8]">
          <Ticket className="w-7 h-7 text-fulus-muted" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white font-display">{t('myHistory')}</h3>
          <p className="text-xs text-[#94a3b8] mt-1">{t('noPurchasesYet')}</p>
        </div>
        {onExploreCampaigns && (
          <button
            onClick={() => {
              triggerHaptic('light');
              onExploreCampaigns();
            }}
            className="fulus-btn-primary px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('openCampaigns')}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-4 text-white pb-safe-dock select-none">
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 font-display">
          <Sparkles className="w-4 h-4 text-[#00d26a]" />
          {t('myHistory')} ({tickets.length})
        </h2>
        <button
          onClick={() => {
            triggerHaptic('light');
            void fetchTickets();
          }}
          aria-label="Refresh tickets"
          className="p-2 rounded-xl bg-[#0e131b] border border-[#1a2230] text-[#94a3b8] hover:text-[#00d26a] transition-colors active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-3.5">
        {tickets.map((res) => {
          const numbers = (res.items || [])
            .map((i) => i.numberValueSnapshot ?? (i as { numberValue?: number }).numberValue ?? 0)
            .sort((a, b) => a - b);
          const dateStr = res.submittedAt
            ? new Date(res.submittedAt).toLocaleDateString()
            : res.createdAt
              ? new Date(res.createdAt).toLocaleDateString()
              : 'Recent';

          const isCopied = copiedRef === res.publicReference;
          const draws = res.lottery?.draws || [];
          const isDrawn = draws.length > 0 || res.lottery?.status === 'COMPLETED';
          const winningNumbers = draws.map((d) => d.winningNumber);
          const wonNumbers = numbers.filter((n) => winningNumbers.includes(n));
          const isWinner = wonNumbers.length > 0;

          return (
            <div
              key={res.id}
              className="ticket-stub p-4 sm:p-5 shadow-xl hover:border-fulus-green/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shrink-0">
                    <Ticket className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs sm:text-sm font-bold text-white font-display truncate">
                      {res.lottery?.title || 'Lottery'}
                    </h4>
                    {res.lottery?.prizeDescription && (
                      <div className="flex items-center gap-1.5 text-xs text-[#f59e0b] font-medium mt-0.5 truncate">
                        <Trophy className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{res.lottery.prizeDescription}</span>
                      </div>
                    )}
                  </div>
                </div>

                {isWinner ? (
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 font-black text-xs tracking-wider shrink-0 shadow-sm flex items-center gap-1 animate-pulse">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                    WINNER
                  </span>
                ) : isDrawn ? (
                  <span className="px-2.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 font-black text-xs tracking-wider shrink-0 shadow-sm flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-blue-400" />
                    ALREADY DRAWN
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-[#0c251b] border border-[#123c2a] text-[#00d26a] font-black text-xs tracking-wider shrink-0 shadow-sm">
                    CONFIRMED • TO BE DRAWN
                  </span>
                )}
              </div>

              {/* Perforated Divider */}
              <div className="ticket-notch-divider" />

              {/* Lucky Numbers Display */}
              <div className="fulus-card-nested p-3">
                <span className="text-xs text-[#94a3b8] block mb-1.5 font-semibold">
                  {t('luckyNumbers')} ({res.ticketCount || numbers.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {numbers.map((n) => {
                    const isWinningNumber = winningNumbers.includes(n);
                    return (
                      <span
                        key={n}
                        className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs sm:text-sm shadow-sm flex items-center gap-1 transition-all ${isWinningNumber
                          ? 'bg-amber-500/25 border-2 border-amber-400 text-amber-300 shadow-amber-500/20 ring-2 ring-amber-400/30'
                          : 'bg-[#0c251b] border border-[#123c2a] text-[#00d26a]'
                          }`}
                      >
                        {isWinningNumber && <Trophy className="w-3 h-3 text-amber-400" />}
                        <span>{n}</span>
                      </span>
                    );
                  })}
                </div>
                {res.totalAmountMinor && (
                  <div className="flex items-center justify-between text-xs pt-2 mt-2 border-t border-[#1a2230]">
                    <span className="text-[#94a3b8]">Total Paid:</span>
                    <span className="font-mono font-bold text-[#00d26a]">
                      {(Number(res.totalAmountMinor) / 100).toFixed(2)} ETB
                      {(res.ticketCount || numbers.length) > 1 && res.lottery?.ticketPriceMinor && (
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          ({res.ticketCount || numbers.length} × {(Number(res.lottery.ticketPriceMinor) / 100).toFixed(2)} ETB)
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Bottom Stub Info with 1-Tap Copy & 100% Trusted Draw Label */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#94a3b8]">
                <button
                  onClick={() => handleCopy(res.publicReference)}
                  className="font-mono text-[#94a3b8] hover:text-white flex items-center gap-1 transition-colors active:scale-95 text-xs font-semibold"
                  title="Click to copy ref"
                >
                  <span>Ref: {res.publicReference}</span>
                  {isCopied ? (
                    <Check className="w-3.5 h-3.5 text-[#00d26a]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Non-clickable 100% Trusted Badge */}
                  <div
                    className="px-2.5 py-1 rounded-lg bg-[#0c251b] border border-[#123c2a] text-[#00d26a] text-xs font-bold flex items-center gap-1 shadow-sm select-none cursor-default"
                    title="100% Trusted Cryptographic Draw"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#00d26a]" />
                    <span>100% Trusted</span>
                  </div>

                  {/* On already drawn tickets, show the drawn lucky number directly in place */}
                  {isDrawn && winningNumbers.length > 0 && (
                    <div
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm select-none ${isWinner
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                        : 'bg-[#131923] border border-[#1a2230] text-slate-300'
                        }`}
                    >
                      <Trophy className="w-3.5 h-3.5 text-amber-400" />
                      <span>Lucky #{winningNumbers.join(', #')}</span>
                    </div>
                  )}

                  <span className="flex items-center gap-1 text-[#94a3b8] text-xs font-medium">
                    <Calendar className="w-3.5 h-3.5" />
                    {dateStr}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Load More Pagination Button */}
        {hasMore && (
          <div className="pt-2 pb-4 text-center">
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="px-6 py-2.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-xs font-bold text-slate-200 hover:text-white transition-all shadow-md active:scale-95 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isLoadingMore ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00d26a]" />
                  <span>Loading more tickets...</span>
                </>
              ) : (
                <span>Load More Tickets</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

