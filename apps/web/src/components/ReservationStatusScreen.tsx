import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Trophy,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { ReservationDetails } from '../types/index.js';
import { api } from '../api/client.js';
import { useLanguage } from '../context/LanguageContext.js';
import { CustomLoader } from './CustomLoader.js';
import { triggerHaptic } from '../utils/haptics.js';

interface ReservationStatusScreenProps {
  reservationId: string;
  onGoHome: () => void;
}

export const ReservationStatusScreen: React.FC<ReservationStatusScreenProps> = ({
  reservationId,
  onGoHome,
}) => {
  const { t } = useLanguage();
  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasCopiedRef, setHasCopiedRef] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const data = await api.getReservation(reservationId);
      setReservation(data);
    } catch (err) {
      console.error('Failed to poll reservation status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();

    // Auto-poll status every 4 seconds while PENDING_REVIEW
    const interval = setInterval(() => {
      if (reservation?.status === 'PENDING_REVIEW' || isLoading) {
        void fetchStatus();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [reservationId, reservation?.status]);

  const hasTriggeredStatusHaptic = React.useRef(false);

  useEffect(() => {
    if (reservation?.status && !hasTriggeredStatusHaptic.current) {
      if (reservation.status === 'CONFIRMED') {
        triggerHaptic('success');
        hasTriggeredStatusHaptic.current = true;
      } else if (reservation.status === 'REJECTED') {
        triggerHaptic('error');
        hasTriggeredStatusHaptic.current = true;
      }
    }
  }, [reservation?.status]);

  const handleCopyRef = async (ref: string) => {
    triggerHaptic('success');
    try {
      await navigator.clipboard.writeText(ref);
      setHasCopiedRef(true);
      setTimeout(() => setHasCopiedRef(false), 2000);
    } catch {
      setHasCopiedRef(true);
      setTimeout(() => setHasCopiedRef(false), 2000);
    }
  };

  if (isLoading) {
    return <CustomLoader fullScreen={false} message="Checking reservation status" />;
  }

  if (!reservation) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-[#94a3b8] space-y-4 pb-safe-dock select-none">
        <p className="text-sm">Reservation details not found.</p>
        <button
          onClick={() => {
            triggerHaptic('light');
            onGoHome();
          }}
          className="fulus-btn-primary px-6 py-2.5 text-xs font-bold active:scale-95"
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  const { status, publicReference, ticketCount, items, lottery } = reservation;
  const numbers = items.map((i) => i.numberValueSnapshot).sort((a, b) => a - b);
  const latestReview = reservation.paymentSubmissions?.[0]?.reviews?.[0];

  return (
    <div className="max-w-md mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-5 text-white pb-safe-dock select-none">
      {/* 1. CONFIRMED STATUS */}
      {status === 'CONFIRMED' && (
        <div className="ticket-stub p-5 sm:p-6 text-center space-y-4 border-[#123c2a] bg-gradient-to-b from-[#0c251b] to-[#0e131b] shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shadow-lg shadow-[#00d26a]/20 animate-bounce">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight font-display">
              {t('ticketsConfirmed')}
            </h2>
            <p className="text-xs text-[#00d26a] mt-1 font-medium">{t('goodLuck')}</p>
          </div>

          <div className="ticket-notch-divider" />

          <div className="fulus-card-nested p-4 text-left space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Campaign:</span>
              <span className="font-bold text-white truncate max-w-[200px]">
                {lottery?.title || 'Lottery'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Ref Code:</span>
              <button
                onClick={() => handleCopyRef(publicReference)}
                className="font-mono font-bold text-[#00d26a] flex items-center gap-1 active:scale-95"
                title="Copy reference"
              >
                <span>{publicReference}</span>
                {hasCopiedRef ? <Check className="w-3 h-3 text-[#00d26a]" /> : <Copy className="w-3 h-3 text-slate-400" />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Total Amount:</span>
              <span className="font-mono font-bold text-[#00d26a]">
                {(Number(reservation.totalAmountMinor) / 100).toFixed(2)} ETB
                {ticketCount > 1 && (
                  <span className="text-[10px] text-slate-400 font-normal ml-1">
                    ({ticketCount} × {(Number(lottery?.ticketPriceMinor || Number(reservation.unitPriceMinor) || 0) / 100).toFixed(2)} ETB)
                  </span>
                )}
              </span>
            </div>
            <div className="pt-2 border-t border-[#1a2230]">
              <span className="text-xs text-[#94a3b8] block mb-1.5 font-medium">
                Confirmed Lucky Numbers ({ticketCount}):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {numbers.map((n) => (
                  <span
                    key={n}
                    className="px-2.5 py-1 rounded-lg bg-[#0c251b] border border-[#123c2a] text-[#00d26a] font-mono font-bold text-xs shadow-sm"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-[#94a3b8]">
            <Trophy className="w-4 h-4 text-[#f59e0b]" />
            <span>Prize: <b className="text-white">{lottery?.prizeDescription}</b></span>
          </div>

          <button
            onClick={() => {
              triggerHaptic('medium');
              onGoHome();
            }}
            className="fulus-btn-primary w-full py-3.5 flex items-center justify-center gap-2 text-sm font-bold active:scale-95 shadow-xl"
          >
            <span>{t('tryAgain')}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. PENDING_REVIEW STATUS */}
      {status === 'PENDING_REVIEW' && (
        <div className="fulus-card p-5 sm:p-6 text-center space-y-4 border-purple-500/30 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20 animate-pulse">
            <Clock className="w-9 h-9" />
          </div>

          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight font-display">
              {t('verificationInProgress')}
            </h2>
            <p className="text-xs text-purple-300/80 mt-1">{t('underReviewNotice')}</p>
          </div>

          <div className="fulus-card-nested p-4 text-left space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Reference:</span>
              <span className="font-mono font-bold text-[#f59e0b]">{publicReference}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Tickets Held:</span>
              <span className="font-mono font-bold text-[#00d26a]">[ {numbers.join(', ')} ]</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#94a3b8]">Total Amount:</span>
              <span className="font-mono font-bold text-white">
                {(Number(reservation.totalAmountMinor) / 100).toFixed(2)} ETB
                {ticketCount > 1 && (
                  <span className="text-[10px] text-slate-400 font-normal ml-1">
                    ({ticketCount} × {(Number(lottery?.ticketPriceMinor || Number(reservation.unitPriceMinor) || 0) / 100).toFixed(2)} ETB)
                  </span>
                )}
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              triggerHaptic('light');
              void fetchStatus();
            }}
            className="w-full py-3 rounded-xl bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('refreshAvailability')}</span>
          </button>
        </div>
      )}

      {/* 3. REJECTED STATUS */}
      {status === 'REJECTED' && (
        <div className="fulus-card p-5 sm:p-6 text-center space-y-4 border-rose-500/30 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
            <XCircle className="w-9 h-9" />
          </div>

          <div>
            <h2 className="text-base sm:text-lg font-bold text-white font-display">{t('statusRejected')}</h2>
            <p className="text-xs text-rose-300/80 mt-1">
              Your payment evidence could not be verified.
            </p>
          </div>

          {latestReview?.reason && (
            <div className="fulus-card-nested p-4 text-left space-y-1 border-rose-500/20">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 block">
                {t('rejectionReason')}
              </span>
              <p className="text-xs text-slate-300 font-medium">{latestReview.reason}</p>
            </div>
          )}

          <p className="text-xs text-[#94a3b8]">
            Your held numbers have been released back to the campaign inventory.
          </p>

          <button
            onClick={() => {
              triggerHaptic('light');
              onGoHome();
            }}
            className="w-full py-3.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-white font-bold text-xs transition-colors active:scale-95"
          >
            {t('tryAgain')}
          </button>
        </div>
      )}

      {/* 4. EXPIRED / CANCELLED */}
      {(status === 'EXPIRED' || status === 'CANCELLED') && (
        <div className="fulus-card p-5 sm:p-6 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#131923] border border-[#1a2230] text-[#94a3b8] flex items-center justify-center">
            <AlertTriangle className="w-9 h-9" />
          </div>

          <div>
            <h2 className="text-base sm:text-lg font-bold text-white font-display">
              {status === 'EXPIRED' ? t('statusExpired') : t('statusCancelled')}
            </h2>
            <p className="text-xs text-[#94a3b8] mt-1">
              {status === 'EXPIRED'
                ? 'The 10-minute hold window expired before payment verification.'
                : 'This reservation was cancelled.'}
            </p>
          </div>

          <button
            onClick={() => {
              triggerHaptic('light');
              onGoHome();
            }}
            className="fulus-btn-primary w-full py-3.5 font-bold text-xs active:scale-95"
          >
            {t('tryAgain')}
          </button>
        </div>
      )}
    </div>
  );
};

