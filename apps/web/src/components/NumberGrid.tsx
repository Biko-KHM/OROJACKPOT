import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  CheckCircle2,
  Clock,
  Lock,
  Eye,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { CampaignSummary, NumberStatus } from '../types/index.js';
import { api } from '../api/client.js';
import { useLanguage } from '../context/LanguageContext.js';
import { triggerHaptic } from '../utils/haptics.js';

interface NumberGridProps {
  campaign: CampaignSummary;
  selectedNumbers: number[];
  onToggleNumber: (numberValue: number) => void;
  onBack: () => void;
  onCheckout: () => void;
  isCheckingOut?: boolean;
  conflictBanner?: string | null;
  onClearConflictBanner?: () => void;
}

const ITEMS_PER_ROW = 5;
const ROW_HEIGHT = 64; // px per row (height + gap)
const BUFFER_ROWS = 4;

export const NumberGrid: React.FC<NumberGridProps> = ({
  campaign,
  selectedNumbers,
  onToggleNumber,
  onBack,
  onCheckout,
  isCheckingOut = false,
  conflictBanner: _conflictBanner,
  onClearConflictBanner: _onClearConflictBanner,
}) => {
  const { t } = useLanguage();
  const [statusMap, setStatusMap] = useState<Map<number, NumberStatus>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(500);

  // Generate all number values in the campaign range
  const allNumbers = useMemo(() => {
    const list: number[] = [];
    for (let i = campaign.numberStart; i <= campaign.numberEnd; i++) {
      list.push(i);
    }
    return list;
  }, [campaign.numberStart, campaign.numberEnd]);

  // Filtered numbers based on search query
  const filteredNumbers = useMemo(() => {
    if (!searchQuery.trim()) return allNumbers;
    const query = searchQuery.trim().toLowerCase();
    return allNumbers.filter((num) => num.toString().includes(query));
  }, [allNumbers, searchQuery]);

  // Fetch numbers summary from API
  const fetchSummary = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setIsLoading(true);
      else setIsRefreshing(true);

      try {
        const summary = await api.getNumbersSummary(campaign.id);
        const map = new Map<number, NumberStatus>();

        // Expand summary ranges into map
        for (const range of summary.ranges) {
          for (let n = range.start; n <= range.end; n++) {
            map.set(n, range.status);
          }
        }

        setStatusMap(map);
        setErrorMessage(null);
      } catch (err: unknown) {
        if (!isBackground) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch inventory';
          setErrorMessage(msg);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [campaign.id],
  );

  // Initial load
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // Short polling every 5 seconds while visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchSummary(true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSummary]);

  // Measure container height
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Track scroll position
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Virtualization Calculations
  const totalRows = Math.ceil(filteredNumbers.length / ITEMS_PER_ROW);
  const totalGridHeight = totalRows * ROW_HEIGHT;

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS,
  );

  const visibleNumbers = useMemo(() => {
    const items: Array<{ numberValue: number; rowIndex: number; colIndex: number }> = [];
    for (let row = startRow; row < endRow; row++) {
      for (let col = 0; col < ITEMS_PER_ROW; col++) {
        const index = row * ITEMS_PER_ROW + col;
        if (index < filteredNumbers.length) {
          items.push({
            numberValue: filteredNumbers[index]!,
            rowIndex: row,
            colIndex: col,
          });
        }
      }
    }
    return items;
  }, [filteredNumbers, startRow, endRow]);

  const pricePerTicket = Number(campaign.ticketPriceMinor) / 100;
  const totalPrice = (pricePerTicket * selectedNumbers.length).toFixed(2);

  const getNumberState = (num: number) => {
    if (selectedNumbers.includes(num)) return 'SELECTED';
    return statusMap.get(num) || 'AVAILABLE';
  };

  const handleNumberClick = (num: number) => {
    const state = getNumberState(num);
    if (state === 'AVAILABLE' || state === 'SELECTED') {
      if (
        !selectedNumbers.includes(num) &&
        selectedNumbers.length >= campaign.maxNumbersPerPurchase
      ) {
        triggerHaptic('warning');
        alert(t('maxLimitNotice', { max: campaign.maxNumbersPerPurchase }));
        return;
      }
      triggerHaptic('selection');
      onToggleNumber(num);
    } else {
      triggerHaptic('warning');
    }
  };

  const handleClearSelection = () => {
    triggerHaptic('light');
    for (const num of [...selectedNumbers]) {
      onToggleNumber(num);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-4xl mx-auto bg-[#080b10] text-slate-100 select-none pb-safe">
      {/* Top Bar with Campaign Info & Back */}
      <div className="p-2.5 sm:p-3.5 bg-[#0e131b]/95 border-b border-[#1a2230] flex items-center justify-between gap-2.5 shrink-0 backdrop-blur-xl">
        <button
          onClick={() => {
            triggerHaptic('light');
            onBack();
          }}
          className="p-2 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-slate-300 transition-colors shrink-0 active:scale-95"
          aria-label="Back to campaigns"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-xs sm:text-sm font-extrabold text-white truncate font-display">
            {campaign.title}
          </h2>
          <p className="text-[11px] sm:text-xs text-amber-400 flex items-center gap-1 truncate font-medium">
            <Sparkles className="w-3 h-3 shrink-0" />
            <span className="truncate">{campaign.prizeDescription}</span>
            <span>•</span>
            <span className="font-mono text-fulus-green font-bold shrink-0">
              {pricePerTicket.toFixed(2)} ETB
            </span>
          </p>
        </div>

        <button
          onClick={() => {
            triggerHaptic('light');
            void fetchSummary(false);
          }}
          className={`p-2 rounded-xl bg-[#131923] text-slate-300 hover:text-fulus-green transition-colors shrink-0 active:scale-95 ${
            isRefreshing ? 'animate-spin text-fulus-green' : ''
          }`}
          title={t('refreshAvailability')}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input & Selection Counter */}
      <div className="px-2.5 sm:px-4 py-1.5 bg-[#0a0d14] border-b border-[#1a2230] flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="number"
            inputMode="numeric"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchNumber')}
            className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-[#0e131b] border border-[#1a2230] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-fulus-green transition-colors font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="px-2.5 py-1.5 rounded-xl bg-[#0c251b] border border-[#123c2a] text-fulus-green text-[10.5px] sm:text-xs font-bold whitespace-nowrap font-mono shadow-sm flex items-center gap-1.5">
          <span>
            {t('numbersSelected', {
              count: selectedNumbers.length,
              max: campaign.maxNumbersPerPurchase,
            })}
          </span>
          {selectedNumbers.length > 0 && (
            <button
              onClick={handleClearSelection}
              className="text-[10px] text-rose-400 hover:text-rose-300 font-bold ml-0.5 hover:underline"
              title="Clear selection"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Minimal Accessible Status Legend */}
      <div className="px-2.5 sm:px-4 py-1 bg-[#080b10] border-b border-[#1a2230] flex items-center justify-between text-[9px] sm:text-[9.5px] overflow-x-auto no-scrollbar gap-1.5 shrink-0">
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-0.5">
          {t('legend')}:
        </span>
        <div className="flex items-center gap-1 text-emerald-400 font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
          <span>{t('statusAvailable')}</span>
        </div>
        <div className="flex items-center gap-1 text-indigo-400 font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
          <span>{t('statusSelected')}</span>
        </div>
        <div className="flex items-center gap-1 text-amber-400 font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
          <span>{t('statusHeld')}</span>
        </div>
        <div className="flex items-center gap-1 text-purple-400 font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block"></span>
          <span>{t('statusPendingReview')}</span>
        </div>
        <div className="flex items-center gap-1 text-slate-500 font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-700 inline-block"></span>
          <span>{t('statusReserved')}</span>
        </div>
      </div>

      {/* Error notification banner */}
      {errorMessage && (
        <div className="mx-3 sm:mx-4 my-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span className="flex-1">{errorMessage}</span>
          <button
            onClick={() => {
              triggerHaptic('light');
              void fetchSummary(false);
            }}
            className="font-bold underline ml-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Virtualized Grid Viewport */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 relative scroll-touch"
        style={{ contain: 'strict' }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-fulus-green" />
            <p className="text-xs">{t('loading')}</p>
          </div>
        ) : filteredNumbers.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            No numbers match your search "{searchQuery}".
          </div>
        ) : (
          <div
            className="w-full relative"
            style={{ height: `${totalGridHeight}px` }}
          >
            {visibleNumbers.map(({ numberValue, rowIndex, colIndex }) => {
              const state = getNumberState(numberValue);

              let buttonStyle =
                'bg-[#0e131b] border-[#1a2230] text-slate-200 hover:bg-[#131923] hover:border-fulus-green active:scale-90';
              let badgeIcon = <CheckCircle2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-fulus-green" />;

              if (state === 'SELECTED') {
                buttonStyle =
                  'bg-fulus-green border-fulus-green text-white font-black shadow-lg shadow-fulus-green/30 scale-95 ring-2 ring-fulus-green active:scale-90';
                badgeIcon = <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />;
              } else if (state === 'HELD') {
                buttonStyle =
                  'bg-amber-950/20 border-amber-500/30 text-amber-400/80 cursor-not-allowed opacity-80';
                badgeIcon = <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-400" />;
              } else if (state === 'PENDING_REVIEW') {
                buttonStyle =
                  'bg-purple-950/20 border-purple-500/30 text-purple-400/80 cursor-not-allowed opacity-80';
                badgeIcon = <Eye className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-purple-400" />;
              } else if (state === 'RESERVED') {
                buttonStyle =
                  'bg-[#080b10] border-[#161c26] text-fulus-dim cursor-not-allowed opacity-50 line-through';
                badgeIcon = <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-fulus-dim" />;
              }

              // Compute absolute positions inside the virtual container
              const top = rowIndex * ROW_HEIGHT;
              const leftPercent = colIndex * 20; // 5 columns = 20% each

              return (
                <div
                  key={numberValue}
                  style={{
                    position: 'absolute',
                    top: `${top}px`,
                    left: `${leftPercent}%`,
                    width: '20%',
                    height: '56px',
                    padding: '2.5px',
                  }}
                >
                  <button
                    onClick={() => handleNumberClick(numberValue)}
                    disabled={state !== 'AVAILABLE' && state !== 'SELECTED'}
                    className={`w-full h-full rounded-2xl border flex flex-col items-center justify-center transition-all ${buttonStyle}`}
                    aria-label={`Number ${numberValue}, Status: ${state}`}
                  >
                    <span className="text-xs sm:text-sm font-bold tracking-tight leading-none font-mono">
                      {numberValue}
                    </span>
                    <span className="mt-0.5">{badgeIcon}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Bottom Selection Bar (Mobile Ergonomics, Above Safe Area & Dock) */}
      {selectedNumbers.length > 0 && (
        <div className="p-3 sm:p-4 bg-[#0e131b]/95 border-t border-fulus-border backdrop-blur-2xl flex items-center justify-between gap-3 shadow-2xl shrink-0 z-30 mb-14 sm:mb-16">
          <div>
            <div className="text-[10px] text-fulus-muted uppercase font-bold tracking-wider flex items-center gap-1.5">
              <span>
                {t('totalPrice')} ({selectedNumbers.length} {selectedNumbers.length === 1 ? 'ticket' : 'tickets'} × {pricePerTicket.toFixed(2)} ETB)
              </span>
              <span className="text-[#00d26a] text-[9px] font-semibold bg-[#00d26a]/15 px-1.5 py-0.5 rounded-md border border-[#00d26a]/30">
                Draft Saved
              </span>
            </div>
            <span className="text-base sm:text-lg font-black text-fulus-green font-mono">
              {totalPrice} <span className="text-xs font-semibold text-fulus-muted">ETB</span>
            </span>
          </div>

          <button
            onClick={() => {
              if (isCheckingOut) return;
              triggerHaptic('medium');
              onCheckout();
            }}
            disabled={isCheckingOut}
            className="fulus-btn-primary px-5 py-2.5 sm:px-6 sm:py-3 text-xs sm:text-sm font-bold shadow-xl active:scale-95 disabled:opacity-60 flex items-center gap-2"
          >
            {isCheckingOut && <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />}
            <span>{isCheckingOut ? t('holdingTickets') : t('holdButton')}</span>
          </button>
        </div>
      )}
    </div>
  );
};

