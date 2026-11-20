import React, { useState, useEffect } from 'react';
import {
  Clock,
  Copy,
  Check,
  UploadCloud,
  FileCheck,
  AlertTriangle,
  CreditCard,
  Phone,
  ShieldCheck,
  RefreshCw,
  XCircle,
  Eye,
  Trash2,
  User,
  Building2,
} from 'lucide-react';
import { ReservationDetails, PaymentAccount, StructuredPaymentInstructions } from '../types/index.js';
import { api } from '../api/client.js';
import { useLanguage } from '../context/LanguageContext.js';
import { useAuth } from '../context/AuthContext.js';
import { triggerHaptic } from '../utils/haptics.js';
import { compressImageFile } from '../utils/imageCompressor.js';

export function parsePaymentInstructions(raw?: string | null): StructuredPaymentInstructions {
  const defaultAccounts: PaymentAccount[] = [
    {
      id: 'acc-cbe',
      type: 'bank',
      title: 'Commercial Bank of Ethiopia (CBE)',
      accountNumber: '1000 0000 0000 0',
      accountName: 'OROJACKPOT Official Bank Account',
    },
    {
      id: 'acc-telebirr',
      type: 'telebirr',
      title: 'Telebirr SuperApp Transfer',
      accountNumber: '0900 00 00 00',
      accountName: 'OROJACKPOT Official Telebirr',
    },
  ];

  if (!raw || !raw.trim()) {
    return { accounts: defaultAccounts };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
      return {
        accounts: parsed.accounts,
        note: parsed.note,
      };
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        accounts: parsed,
      };
    }
  } catch {
    // Legacy plain text
  }

  return {
    accounts: defaultAccounts,
    note: raw,
  };
}

interface HoldScreenProps {
  reservation: ReservationDetails;
  onPaymentSubmitted: (submissionId: string) => void;
  onHoldCancelled: () => void;
}

export const HoldScreen: React.FC<HoldScreenProps> = ({
  reservation,
  onPaymentSubmitted,
  onHoldCancelled,
}) => {
  const { t } = useLanguage();
  const { user } = useAuth();

  // Expiry timer
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    if (reservation.holdExpiresAt) {
      const diff = Math.floor((new Date(reservation.holdExpiresAt).getTime() - Date.now()) / 1000);
      return Math.max(0, diff);
    }
    const mins = reservation.lottery?.holdMinutes || 10;
    return mins * 60;
  });

  const [copiedAccountId, setCopiedAccountId] = useState<string | null>(null);

  const paymentData = React.useMemo(() => {
    return parsePaymentInstructions(reservation.lottery?.paymentInstructions);
  }, [reservation.lottery?.paymentInstructions]);

  // Verified Telegram identity taken automatically from authenticated session
  const autoTelegramHandle = user?.username ? `@${user.username}` : '';
  const autoTelegramId = user?.telegramUserId ? String(user.telegramUserId) : '';
  const autoFullName =
    (user?.firstName || user?.lastName
      ? [user.firstName, user.lastName].filter(Boolean).join(' ')
      : autoTelegramHandle || (autoTelegramId ? `Player #${autoTelegramId}` : '')) || '';

  // File upload & Contact Info state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fullNameInput, setFullNameInput] = useState<string>(() => autoFullName);
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // Sync if user object resolves asynchronously
  useEffect(() => {
    if (!fullNameInput && autoFullName) {
      setFullNameInput(autoFullName);
    }
  }, [autoFullName, fullNameInput]);

  // Cleanup object URL when file changes
  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
    }
  }, [file]);

  // Enable closing confirmation while active hold countdown is running
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.enableClosingConfirmation) {
      window.Telegram.WebApp.enableClosingConfirmation();
    }
    return () => {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.disableClosingConfirmation) {
        window.Telegram.WebApp.disableClosingConfirmation();
      }
    };
  }, []);

  // Countdown effect
  useEffect(() => {
    if (secondsRemaining <= 0) {
      triggerHaptic('error');
      return;
    }
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          triggerHaptic('error');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const copyToClipboard = async (text: string, accountId: string) => {
    triggerHaptic('success');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAccountId(accountId);
      setTimeout(() => setCopiedAccountId(null), 2000);
    } catch {
      // Fallback
      setCopiedAccountId(accountId);
      setTimeout(() => setCopiedAccountId(null), 2000);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const selected = e.target.files?.[0];
    if (!selected) return;

    let processedFile: File | Blob = selected;
    if (selected.type.startsWith('image/')) {
      try {
        processedFile = await compressImageFile(selected, {
          maxDimension: 1200,
          quality: 0.85,
          mimeType: 'image/jpeg',
        });
      } catch {
        processedFile = selected;
      }
    }

    // Check size limit: 5MB after compression
    if (processedFile.size > 5 * 1024 * 1024) {
      triggerHaptic('warning');
      setErrorMessage(t('fileSizeError'));
      return;
    }

    // Check mime type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(processedFile.type) && !validTypes.includes(selected.type)) {
      triggerHaptic('warning');
      setErrorMessage(t('fileTypeError'));
      return;
    }

    triggerHaptic('selection');
    const finalFile =
      processedFile instanceof File
        ? processedFile
        : new File([processedFile], selected.name.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    setFile(finalFile);
  };

  const handleRemoveFile = () => {
    triggerHaptic('light');
    setFile(null);
    setPreviewUrl(null);
  };

  const calculateSha256 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMessage(t('uploadProof'));
      return;
    }

    // Automatically take the verified Telegram username or ID - no manual filling required
    const verifiedIdentity = autoTelegramHandle
      ? `${autoTelegramHandle} (TG: ${autoTelegramId || 'Verified'})`
      : autoTelegramId
      ? `TG: ${autoTelegramId}`
      : autoFullName || 'Authenticated Player';

    const customName = fullNameInput.trim();
    const phone = phoneInput.trim();

    // Construct tamper-proof combined reference with verified Telegram identity
    const referenceParts = [
      verifiedIdentity,
      customName && customName !== verifiedIdentity && customName !== autoTelegramHandle ? customName : null,
      phone ? `Phone: ${phone}` : null,
    ].filter(Boolean);
    const combinedReference = referenceParts.join(' • ');

    triggerHaptic('medium');
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Calculate SHA-256 hash of the evidence file
      const sha256 = await calculateSha256(file);

      // 2. Request presigned upload URL from server
      const presign = await api.getPresignedUploadUrl(file.name, file.type);

      // 3. Upload file directly to presigned URL
      await api.uploadFileToPresignedUrl(presign.uploadUrl, file, file.type);

      // 5. Submit payment evidence transactionally
      const submission = await api.submitPayment(reservation.id, {
        storageKey: presign.storageKey,
        originalFilename: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        fileSha256: sha256,
        paymentReference: combinedReference,
      });

      triggerHaptic('success');
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.disableClosingConfirmation) {
        window.Telegram.WebApp.disableClosingConfirmation();
      }
      onPaymentSubmitted(submission.submissionId);
    } catch (err: unknown) {
      triggerHaptic('error');
      const msg = err instanceof Error ? err.message : 'Failed to submit payment proof';
      setErrorMessage(msg);
      setIsSubmitting(false);
    }
  };

  const handleCancelReservation = async () => {
    if (!confirm('Are you sure you want to cancel this hold and release your numbers?')) {
      return;
    }

    triggerHaptic('medium');
    setIsCancelling(true);
    try {
      await api.cancelReservation(reservation.id);
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.disableClosingConfirmation) {
        window.Telegram.WebApp.disableClosingConfirmation();
      }
      onHoldCancelled();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel hold';
      alert(msg);
      setIsCancelling(false);
    }
  };

  const unitPriceMinor = reservation.lottery?.ticketPriceMinor
    ? Number(reservation.lottery.ticketPriceMinor)
    : reservation.unitPriceMinor
    ? Number(reservation.unitPriceMinor)
    : reservation.items?.[0]?.unitPriceMinor
    ? Number(reservation.items[0].unitPriceMinor)
    : Number(reservation.totalAmountMinor) / Math.max(1, reservation.ticketCount);
  const unitPriceEtb = (unitPriceMinor / 100).toFixed(2);
  const amountEtb = (Number(reservation.totalAmountMinor) / 100).toFixed(2);
  const isUrgent = secondsRemaining < 120 && secondsRemaining > 0;
  const isExpired = secondsRemaining === 0;

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-5 text-slate-100 pb-36 sm:pb-44 select-none">
      {/* Hold Notice Card with Countdown */}
      <div
        className={`ticket-stub p-4 sm:p-5 transition-all shadow-xl ${
          isExpired
            ? 'border-rose-500/50 bg-rose-950/20'
            : isUrgent
            ? 'border-amber-500/50 bg-amber-950/20 animate-pulse'
            : 'border-[#1a2d24] bg-gradient-to-br from-[#0c251b] via-[#0e1724] to-[#121c2c]'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div
              className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                isExpired
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : isUrgent
                  ? 'fulus-icon-box-amber'
                  : 'fulus-icon-box-green'
              }`}
            >
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-extrabold text-white leading-tight font-display">
                {isExpired ? t('statusExpired') : t('holdTimeRemaining')}
              </h3>
              <p className="text-[11px] sm:text-xs text-fulus-muted mt-0.5">{t('holdNotice')}</p>
            </div>
          </div>

          <div
            className={`text-xl sm:text-2xl font-black font-mono tracking-tight shrink-0 px-2.5 py-1 rounded-xl bg-[#080b10] border border-[#1a2230] ${
              isExpired ? 'text-rose-400' : isUrgent ? 'text-amber-400' : 'text-fulus-green'
            }`}
          >
            {timeFormatted}
          </div>
        </div>

        <div className="ticket-notch-divider" />

        {/* Selected numbers chips & total price breakdown */}
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="text-fulus-muted flex items-center flex-wrap gap-1.5 min-w-0">
            <span className="font-semibold text-slate-300 shrink-0">
              Tickets ({reservation.ticketCount} × {unitPriceEtb} ETB):
            </span>
            <span className="text-white font-mono font-bold">
              [ {reservation.items.map((i) => i.numberValueSnapshot).join(', ')} ]
            </span>
          </div>
          <span className="font-black text-fulus-green text-base sm:text-lg font-mono shrink-0">
            {amountEtb} ETB
          </span>
        </div>
      </div>


      {/* Official Bank & Telebirr Accounts */}
      <div className="fulus-card p-4 sm:p-5 space-y-3.5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2 font-display">
            <ShieldCheck className="w-4 h-4 text-fulus-green" />
            {t('paymentInstructions')}
          </h3>
          <span className="text-xs font-mono font-bold text-fulus-green bg-fulus-green/10 px-2.5 py-1 rounded-lg border border-fulus-green/20">
            {amountEtb} ETB
          </span>
        </div>

        {paymentData.accounts.map((acc, idx) => {
          const isCopied = copiedAccountId === acc.id || copiedAccountId === String(idx);
          const cleanNumber = acc.accountNumber.replace(/\s+/g, '');
          const isTelebirr = acc.type === 'telebirr' || /telebirr|phone|mobile/i.test(acc.title);
          const isBank = !isTelebirr;

          return (
            <div
              key={acc.id || idx}
              className="p-3.5 sm:p-4 rounded-2xl bg-[#131923] border border-fulus-border flex items-center justify-between gap-3 transition-colors hover:border-[#1e293b]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`p-2 sm:p-2.5 rounded-xl shrink-0 ${
                    isBank
                      ? 'bg-purple-500/15 text-purple-400'
                      : isTelebirr
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'bg-emerald-500/15 text-emerald-400'
                  }`}
                >
                  {isBank ? (
                    <CreditCard className="w-5 h-5" />
                  ) : isTelebirr ? (
                    <Phone className="w-5 h-5" />
                  ) : (
                    <Building2 className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-white block truncate">{acc.title}</span>
                  <span className="text-sm font-mono font-semibold text-slate-200 block truncate">
                    {acc.accountNumber}
                  </span>
                  {acc.accountName && (
                    <span className="text-xs text-fulus-muted block truncate mt-0.5">{acc.accountName}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(cleanNumber, acc.id || String(idx))}
                className="fulus-btn-primary py-2 px-3.5 text-xs font-bold active:scale-95 shrink-0"
                title={`Copy ${acc.title}`}
                aria-label={`Copy ${acc.title}`}
              >
                {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          );
        })}

        {paymentData.note && (
          <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-fulus-border/60 text-[11px] text-fulus-muted flex items-start gap-2">
            <span className="text-fulus-green font-bold shrink-0">ℹ</span>
            <span className="leading-relaxed">
              {paymentData.note.replace(/Please include your reservation code in deposit description\.?/gi, 'Please upload your payment screenshot after completing transfer.').trim()}
            </span>
          </div>
        )}
      </div>

      {/* Upload Payment Evidence Form */}
      <form onSubmit={handleSubmitProof} className="fulus-card p-4 sm:p-5 space-y-4 shadow-xl">
        <div>
          <h3 className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-2 font-display">
            <UploadCloud className="w-4 h-4 text-fulus-green" />
            {t('uploadProof')}
          </h3>
          <p className="text-[11px] sm:text-xs text-fulus-muted mt-0.5">{t('uploadHint')}</p>
        </div>

        {/* File Picker Card with Mobile Live Preview */}
        <label className="block relative border-2 border-dashed border-fulus-border hover:border-fulus-green rounded-2xl p-4 sm:p-6 text-center cursor-pointer transition-colors bg-[#080b10] active:scale-[0.99]">
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="hidden"
            disabled={isSubmitting || isExpired}
          />
          {file ? (
            <div className="flex flex-col items-center justify-center space-y-2 text-fulus-green">
              {previewUrl ? (
                <div className="relative group max-h-36 overflow-hidden rounded-xl border border-[#1a2230]">
                  <img
                    src={previewUrl}
                    alt="Receipt preview"
                    className="max-h-36 object-contain rounded-xl"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Eye className="w-5 h-5 text-white" />
                  </div>
                </div>
              ) : (
                <FileCheck className="w-8 h-8" />
              )}
              <span className="text-xs font-bold text-white max-w-xs truncate">{file.name}</span>
              <span className="text-[10px] text-fulus-muted">
                {(file.size / 1024).toFixed(1)} KB • Tap to change
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleRemoveFile();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 text-[10px] font-bold hover:bg-rose-500/25 transition-colors mt-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-2 text-fulus-muted py-2">
              <div className="w-10 h-10 rounded-full bg-[#131923] flex items-center justify-center text-fulus-green">
                <UploadCloud className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-slate-300">
                Tap to capture or upload receipt screenshot
              </span>
              <span className="text-[10px] text-fulus-dim">
                Supports JPEG, PNG, WebP or PDF (max 5 MB)
              </span>
            </div>
          )}
        </label>

        {/* Customer Contact Details (Structured & Clean) */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-[#080b10]/90 border border-[#1a2230] space-y-3 shadow-inner">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>{t('fullNameLabel')}</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={fullNameInput}
                  onChange={(e) => {
                    setFullNameInput(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder={t('namePlaceholder')}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#0c1017] border border-fulus-border text-xs sm:text-sm text-white placeholder-fulus-dim focus:outline-none focus:border-emerald-500 font-medium transition-colors"
                  disabled={isSubmitting || isExpired}
                />
              </div>
            </div>

            {/* Phone Number */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>{t('phoneNumberLabel')}</span>
                <span className="text-xs text-slate-500 font-medium lowercase font-mono">optional</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder={t('phonePlaceholder')}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#0c1017] border border-fulus-border text-xs sm:text-sm text-white placeholder-fulus-dim focus:outline-none focus:border-emerald-500 font-mono font-medium transition-colors"
                  disabled={isSubmitting || isExpired}
                />
              </div>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!file || isSubmitting || isExpired}
          className="fulus-btn-primary w-full py-3.5 rounded-2xl text-xs sm:text-sm active:scale-98 shadow-xl"
        >
          {isSubmitting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              <span>{t('submitting')}</span>
            </>
          ) : (
            <span>{t('submitPayment')}</span>
          )}
        </button>

        {/* Cancel hold button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleCancelReservation}
            disabled={isCancelling || isSubmitting}
            className="w-full py-3 px-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/25 border border-rose-500/25 hover:border-rose-500/40 text-rose-300 hover:text-rose-200 transition-all text-xs font-bold inline-flex items-center justify-center gap-2 active:scale-98 disabled:opacity-40"
          >
            {isCancelling ? (
              <RefreshCw className="w-4 h-4 animate-spin text-rose-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{t('cancelHold')}</span>
          </button>
        </div>
      </form>

      {/* Ample bottom spacer to ensure clearance above the floating bottom dock navigation */}
      <div className="h-16 sm:h-20" aria-hidden="true" />
    </div>
  );
};

