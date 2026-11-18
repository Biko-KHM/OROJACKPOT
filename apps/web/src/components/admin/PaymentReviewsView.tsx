import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  RefreshCw,
  ExternalLink,
  FileText,
  Check,
  Loader2,
  X,
  Search,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Trash2,
} from 'lucide-react';
import { api, ApiError, resolveUrl } from '../../api/client.js';
import { PaymentSubmissionReviewItem, AdminLottery } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

export const PaymentReviewsView: React.FC = () => {
  const [submissions, setSubmissions] = useState<PaymentSubmissionReviewItem[]>([]);
  const [lotteries, setLotteries] = useState<AdminLottery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'SUBMITTED' | 'ALL'>('SUBMITTED');
  const [historySubFilter, setHistorySubFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('ALL');

  // Purge Campaign Payments Modal State
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [purgeTargetLotteryId, setPurgeTargetLotteryId] = useState<string>('');
  const [purgeMode, setPurgeMode] = useState<'ALL' | 'PENDING_ONLY'>('ALL');
  const [isPurging, setIsPurging] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Creative Campaign Dropdown state
  const campaignDropdownRef = useRef<HTMLDivElement>(null);
  const [isCampaignDropdownOpen, setIsCampaignDropdownOpen] = useState(false);
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');

  // Review Active Modal
  const [activeReviewItem, setActiveReviewItem] = useState<PaymentSubmissionReviewItem | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState(false);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [comparedWithBankRecord, setComparedWithBankRecord] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);

  // Reject Modal State
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (campaignDropdownRef.current && !campaignDropdownRef.current.contains(event.target as Node)) {
        setIsCampaignDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSubmissions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [submissionsData, lotteriesData] = await Promise.all([
        api.getAdminSubmissions(statusFilter === 'ALL' ? undefined : 'SUBMITTED'),
        api.getAdminLotteries().catch(() => []),
      ]);
      setSubmissions(Array.isArray(submissionsData) ? submissionsData : []);
      if (Array.isArray(lotteriesData)) {
        setLotteries(lotteriesData);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch payment submissions');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchSubmissions();
  }, [fetchSubmissions]);

  // Duplicate Receipt File SHA256 Detection (FR-20)
  const duplicatesMap = useMemo(() => {
    const hashCounts = new Map<string, number>();

    for (const sub of submissions) {
      if (sub.fileSha256) {
        hashCounts.set(sub.fileSha256, (hashCounts.get(sub.fileSha256) || 0) + 1);
      }
    }

    return { hashCounts };
  }, [submissions]);

  // Unique campaigns and metrics
  const campaignStats = useMemo(() => {
    const map = new Map<string, { lotteryId: string; total: number; pending: number; approved: number; rejected: number }>();

    for (const sub of submissions) {
      const campTitle = sub.reservation.lotteryTitle || 'Untitled Campaign';
      const lotteryId = sub.reservation.lotteryId || '';
      const existing = map.get(campTitle) || { lotteryId, total: 0, pending: 0, approved: 0, rejected: 0 };
      if (!existing.lotteryId && lotteryId) existing.lotteryId = lotteryId;
      existing.total += 1;
      if (sub.status === 'SUBMITTED') existing.pending += 1;
      else if (sub.status === 'APPROVED') existing.approved += 1;
      else if (sub.status === 'REJECTED') existing.rejected += 1;
      map.set(campTitle, existing);
    }

    return Array.from(map.entries()).map(([title, stats]) => ({
      title,
      ...stats,
    }));
  }, [submissions]);

  const handleOpenPurgeModal = (preselectedLotteryId?: string) => {
    let targetId = preselectedLotteryId || '';
    if (!targetId && selectedCampaign !== 'ALL') {
      const match = lotteries.find((l) => l.title === selectedCampaign) ||
                    submissions.find((s) => s.reservation.lotteryTitle === selectedCampaign)?.reservation;
      if (match) targetId = (match as { id?: string; lotteryId?: string }).lotteryId || (match as { id?: string }).id || '';
    }
    if (!targetId) {
      alert('Please select a specific campaign first to erase its payments.');
      return;
    }
    setPurgeTargetLotteryId(targetId);
    setPurgeMode('ALL');
    setPurgeConfirmText('');
    setIsPurgeModalOpen(true);
  };

  const handleExecutePurge = async () => {
    if (!purgeTargetLotteryId) {
      alert('Please select a campaign to erase payments.');
      return;
    }
    if (purgeConfirmText.toUpperCase() !== 'PURGE') {
      alert('Please type "PURGE" to confirm this action.');
      return;
    }

    setIsPurging(true);
    setActionSuccess(null);
    try {
      const res = await api.purgeCampaignPayments(purgeTargetLotteryId, purgeMode);
      setIsPurgeModalOpen(false);
      setActionSuccess(res.message);
      await fetchSubmissions();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to erase campaign payments');
    } finally {
      setIsPurging(false);
    }
  };

  const totalPendingAll = useMemo(() => {
    return submissions.filter((s) => s.status === 'SUBMITTED').length;
  }, [submissions]);

  // Filtered campaign list inside dropdown search
  const filteredCampaignList = useMemo(() => {
    if (!campaignSearchQuery.trim()) return campaignStats;
    const q = campaignSearchQuery.toLowerCase().trim();
    return campaignStats.filter((c) => c.title.toLowerCase().includes(q));
  }, [campaignStats, campaignSearchQuery]);

  // Filtered submissions based on campaign, status, and search query
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((sub) => {
      // 1. Campaign filter
      if (selectedCampaign !== 'ALL' && sub.reservation.lotteryTitle !== selectedCampaign) {
        return false;
      }

      // 2. Status filter
      if (statusFilter === 'SUBMITTED') {
        if (sub.status !== 'SUBMITTED') return false;
      } else {
        if (historySubFilter !== 'ALL' && sub.status !== historySubFilter) {
          return false;
        }
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const user = (sub.reservation.customerUsername || '').toLowerCase();
        const tgId = (sub.reservation.customerTelegramId || '').toLowerCase();
        const camp = (sub.reservation.lotteryTitle || '').toLowerCase();
        if (
          !user.includes(q) &&
          !tgId.includes(q) &&
          !camp.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [submissions, selectedCampaign, statusFilter, historySubFilter, searchQuery]);

  // Reset to first page when campaign, filters, or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCampaign, statusFilter, historySubFilter, searchQuery, pageSize]);

  // Pagination calculations
  const totalItems = filteredSubmissions.length;
  const effectivePageSize = pageSize === 0 ? totalItems : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / (effectivePageSize || 1)));
  const startIndex = (currentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalItems);
  const paginatedSubmissions = pageSize === 0 ? filteredSubmissions : filteredSubmissions.slice(startIndex, endIndex);

  const getVisiblePages = () => {
    const delta = 2;
    const range: (number | string)[] = [];
    const left = Math.max(2, currentPage - delta);
    const right = Math.min(totalPages - 1, currentPage + delta);

    range.push(1);
    if (left > 2) range.push('...');
    for (let i = left; i <= right; i++) {
      range.push(i);
    }
    if (right < totalPages - 1) range.push('...');
    if (totalPages > 1) range.push(totalPages);
    return range;
  };

  // KPI calculations for filtered set
  const currentTotalAmount = useMemo(() => {
    return filteredSubmissions.reduce(
      (acc, sub) => acc + BigInt(sub.reservation.totalAmountMinor || '0'),
      0n
    );
  }, [filteredSubmissions]);

  const currentFlaggedCount = useMemo(() => {
    return filteredSubmissions.filter((sub) => {
      const isDuplicateHash = (duplicatesMap.hashCounts.get(sub.fileSha256) || 0) > 1;
      return isDuplicateHash;
    }).length;
  }, [filteredSubmissions, duplicatesMap]);

  const handleOpenReview = async (item: PaymentSubmissionReviewItem) => {
    setActiveReviewItem(item);
    setComparedWithBankRecord(false);
    setReviewNote('');
    setEvidenceUrl(null);
    setEvidenceError(false);
    setIsLoadingEvidence(true);

    try {
      const res = await api.getAdminSubmissionEvidenceUrl(item.id);
      const url = res.downloadUrl.startsWith('http') ? res.downloadUrl : resolveUrl(res.downloadUrl);
      setEvidenceUrl(url);
    } catch (err) {
      setEvidenceError(true);
      alert(err instanceof Error ? err.message : 'Failed to retrieve evidence URL');
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  const handleApprove = async () => {
    if (!activeReviewItem) return;
    if (!comparedWithBankRecord) {
      alert('Please confirm that you have verified this evidence with the actual bank record before approving.');
      return;
    }

    setIsSubmittingDecision(true);
    setActionSuccess(null);

    try {
      const res = await api.approvePaymentSubmission(activeReviewItem.id, true, reviewNote.trim() || undefined);
      if (res.status === 'PENDING_SECOND_APPROVAL') {
        setActionSuccess(`First approval recorded for @${activeReviewItem.reservation.customerUsername || 'buyer'}. Waiting for second administrator confirmation.`);
        alert('First approval recorded! Because this high-value payment requires dual approval, a second administrator must confirm it before tickets are finalized.');
      } else {
        setActionSuccess(`Payment for @${activeReviewItem.reservation.customerUsername || 'buyer'} approved successfully! Lucky tickets have been issued.`);
      }
      setActiveReviewItem(null);
      await fetchSubmissions();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        alert(err.message || 'Approval failed');
      } else {
        alert('Failed to approve submission');
      }
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!activeReviewItem || !rejectReason.trim()) return;

    setIsSubmittingDecision(true);
    setActionSuccess(null);

    try {
      await api.rejectPaymentSubmission(activeReviewItem.id, rejectReason.trim(), comparedWithBankRecord);
      setActionSuccess(`Submission for @${activeReviewItem.reservation.customerUsername || 'buyer'} rejected.`);
      setIsRejectModalOpen(false);
      setActiveReviewItem(null);
      setRejectReason('');
      await fetchSubmissions();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        alert(err.message || 'Rejection failed');
      } else {
        alert('Failed to reject submission');
      }
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const formatETB = (minor: string | null | undefined): string => {
    if (!minor) return '0.00 ETB';
    const num = Number(BigInt(minor)) / 100;
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1a2230]">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Payment Evidence Reviews</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit customer proof, detect duplicate references, and confirm CBE/Telebirr settlements
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => void fetchSubmissions()}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-300 transition-colors shadow-sm active:scale-95"
            title="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-2xl bg-[#0c251b] border border-[#123c2a] text-emerald-300 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold p-1">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-900/50 text-rose-300 text-xs flex items-center gap-2 shadow-lg">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Categorize by Campaign - Creative & Structured Dropdown */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl bg-[#0e131b] border border-[#1a2230] shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0c251b] border border-[#123c2a] text-emerald-400 flex items-center justify-center shrink-0 shadow-sm shadow-[#00d26a]/15">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wide uppercase flex items-center gap-2">
              <span>Categorize by Campaign</span>
              {selectedCampaign !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0c251b] text-emerald-400 border border-[#123c2a]">
                  Active Filter
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {selectedCampaign === 'ALL'
                ? `Showing payments across all ${campaignStats.length} campaigns (${submissions.length} submissions, ${totalPendingAll} to approve)`
                : `Showing submissions for "${selectedCampaign}" (${filteredSubmissions.length} submissions)`}
            </p>
          </div>
        </div>

        {/* Dropdown Selector & Erase Payments Action */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          <div className="relative min-w-[200px] sm:min-w-[270px] flex-1 sm:flex-initial" ref={campaignDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCampaignDropdownOpen(!isCampaignDropdownOpen)}
              className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#080b10] hover:bg-[#131923] border border-[#1a2230] hover:border-[#243044] text-xs font-medium text-white transition-all shadow-inner group"
            >
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate font-bold text-white">
                {selectedCampaign === 'ALL' ? 'All Campaigns' : selectedCampaign}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-[#131923] text-slate-400 border border-[#1a2230]">
                {selectedCampaign === 'ALL'
                  ? `${submissions.length} Total`
                  : `${campaignStats.find((c) => c.title === selectedCampaign)?.total || 0} Total`}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 group-hover:text-emerald-400 ${
                  isCampaignDropdownOpen ? 'rotate-180 text-emerald-400' : ''
                }`}
              />
            </div>
          </button>

          {/* Dropdown Menu Popover */}
          <div
            className={`absolute right-0 top-full mt-2 z-30 w-full sm:w-[340px] rounded-2xl bg-[#0e131b] border border-[#1a2230] shadow-2xl p-2 space-y-1.5 backdrop-blur-xl transition-all ${
              isCampaignDropdownOpen ? 'block' : 'hidden'
            }`}
          >
            {/* Quick Search inside dropdown if more than 3 campaigns */}
            {campaignStats.length > 3 && (
              <div className="relative px-1 pt-1 pb-1.5">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={campaignSearchQuery}
                  onChange={(e) => setCampaignSearchQuery(e.target.value)}
                  placeholder="Search campaign name..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#080b10] border border-[#1a2230] text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {/* All Campaigns Option */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCampaign('ALL');
                  setIsCampaignDropdownOpen(false);
                  setCampaignSearchQuery('');
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors text-xs ${
                  selectedCampaign === 'ALL'
                    ? 'bg-[#0c251b] border border-[#123c2a] text-emerald-400'
                    : 'hover:bg-[#131923] text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {selectedCampaign === 'ALL' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5" />
                  )}
                  <span className="font-bold truncate">All Campaigns</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                  <span className="text-slate-400">{submissions.length} Total</span>
                  {totalPendingAll > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full font-bold bg-[#261a0c] text-amber-400 border border-[#422b13]">
                      {totalPendingAll} pending
                    </span>
                  )}
                </div>
              </button>

              {/* Individual Campaign Options */}
              {filteredCampaignList.map((camp) => {
                const isSelected = selectedCampaign === camp.title;
                return (
                  <button
                    key={camp.title}
                    type="button"
                    onClick={() => {
                      setSelectedCampaign(camp.title);
                      setIsCampaignDropdownOpen(false);
                      setCampaignSearchQuery('');
                    }}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors text-xs ${
                      isSelected
                        ? 'bg-[#0c251b] border border-[#123c2a] text-emerald-400'
                        : 'hover:bg-[#131923] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {isSelected ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <span className="w-3.5 h-3.5" />
                      )}
                      <span className="font-semibold truncate text-white" title={camp.title}>
                        {camp.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                      <span className="text-slate-400">{camp.total} Total</span>
                      {camp.pending > 0 ? (
                        <span className="px-1.5 py-0.2 rounded-full font-bold bg-[#261a0c] text-amber-400 border border-[#422b13]">
                          {camp.pending} to approve
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded-full font-bold bg-[#0c251b] text-emerald-400 border border-[#123c2a]">
                          0 pending
                        </span>
                      )}
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsCampaignDropdownOpen(false);
                          handleOpenPurgeModal(camp.lotteryId);
                        }}
                        className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-950/60 transition-colors cursor-pointer"
                        title={`Erase payments for single campaign: "${camp.title}"`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Erase Campaign Payments Action Button - strictly visible only for a single selected campaign */}
        {selectedCampaign !== 'ALL' && (
          <button
            type="button"
            onClick={() => handleOpenPurgeModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800/60 hover:border-rose-600/70 text-rose-300 hover:text-white font-extrabold text-xs shadow-md transition-all active:scale-95 shrink-0"
            title={`Erase payments and restore tickets only for "${selectedCampaign}"`}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Erase Payments for This Campaign</span>
          </button>
        )}
      </div>
    </div>

      {/* Quick Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-[#0e131b] border border-[#1a2230] flex flex-col justify-between shadow-md">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filtered Queue</span>
          <span className="text-lg font-black text-white mt-1 font-mono">{filteredSubmissions.length}</span>
        </div>
        <div className="p-3.5 rounded-2xl bg-[#261a0c] border border-[#422b13] flex flex-col justify-between shadow-md">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">To Be Approved</span>
          <span className="text-lg font-black text-amber-400 mt-1 font-mono">
            {filteredSubmissions.filter((s) => s.status === 'SUBMITTED').length}
          </span>
        </div>
        <div className="p-3.5 rounded-2xl bg-[#0e131b] border border-[#1a2230] flex flex-col justify-between shadow-md">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expected ETB Volume</span>
          <span className="text-lg font-black text-emerald-400 mt-1 font-mono">{formatETB(currentTotalAmount.toString())}</span>
        </div>
        <div
          className={`p-3.5 rounded-2xl border flex flex-col justify-between shadow-md ${
            currentFlaggedCount > 0 ? 'bg-rose-950/30 border-rose-900/40' : 'bg-[#0e131b] border-[#1a2230]'
          }`}
        >
          <span
            className={`text-[10px] font-bold uppercase tracking-wider ${
              currentFlaggedCount > 0 ? 'text-rose-400' : 'text-slate-400'
            }`}
          >
            Fraud Alerts
          </span>
          <span
            className={`text-lg font-black mt-1 font-mono ${
              currentFlaggedCount > 0 ? 'text-rose-400' : 'text-slate-400'
            }`}
          >
            {currentFlaggedCount}
          </span>
        </div>
      </div>

      {/* Filter and Structured Table Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 rounded-2xl bg-[#0e131b] border border-[#1a2230] shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary View Mode */}
          <div className="flex items-center gap-1 bg-[#080b10] p-1 rounded-xl border border-[#1a2230] text-xs">
            <button
              onClick={() => setStatusFilter('SUBMITTED')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                statusFilter === 'SUBMITTED'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>To Be Approved</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  statusFilter === 'SUBMITTED' ? 'bg-slate-950 text-amber-400' : 'bg-[#261a0c] text-amber-400 border border-[#422b13]'
                }`}
              >
                {submissions.filter((s) => s.status === 'SUBMITTED').length}
              </span>
            </button>
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                statusFilter === 'ALL' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Payment History</span>
              <span className="text-[10px] text-slate-400 font-bold">
                ({submissions.length})
              </span>
            </button>
          </div>

          {/* Sub-filter when on Payment History */}
          {statusFilter === 'ALL' && (
            <div className="flex items-center gap-1 bg-[#080b10] p-1 rounded-xl border border-[#1a2230] text-xs">
              {(['ALL', 'APPROVED', 'REJECTED'] as const).map((subFilter) => (
                <button
                  key={subFilter}
                  onClick={() => setHistorySubFilter(subFilter)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                    historySubFilter === subFilter
                      ? subFilter === 'APPROVED'
                        ? 'bg-[#0c251b] text-emerald-400 border border-[#123c2a]'
                        : subFilter === 'REJECTED'
                        ? 'bg-rose-950/50 text-rose-300 border border-rose-900/50'
                        : 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {subFilter}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search & Page Size Select */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, telegram, campaign..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-medium"
            />
          </div>

          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Items per page"
            className="px-2.5 py-1.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-slate-300 font-medium focus:outline-none focus:border-emerald-500"
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={0}>All</option>
          </select>
        </div>
      </div>

      {/* 2. Minimized, Structured Table */}
      {isLoading && submissions.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading payment submissions"
          subtitle="Fetching bank statement verification queue and fraud flags"
        />
      ) : filteredSubmissions.length === 0 ? (
        <div className="text-center py-16 bg-[#0e131b]/60 rounded-3xl border border-[#1a2230] text-slate-400 text-xs space-y-1">
          <p className="font-bold text-sm text-slate-300">
            {statusFilter === 'SUBMITTED'
              ? 'No pending payment reviews in queue'
              : 'No payment submissions found'}
          </p>
          <p className="text-[11px] text-slate-500">
            {selectedCampaign !== 'ALL'
              ? `No entries match campaign "${selectedCampaign}" with current filters.`
              : 'Try clearing your search or switching filters.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#1a2230] bg-[#0e131b] shadow-xl custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-[#1a2230] bg-[#080b10]/95 text-slate-400 font-bold uppercase tracking-wider text-[9px] sm:text-[9.5px]">
                <th className="py-2.5 px-3 whitespace-nowrap">Customer</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Campaign</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Receipt</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Tickets & Total</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Status & Flags</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Submitted At</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2230]/70 text-[10px] sm:text-[10.5px]">
              {paginatedSubmissions.map((sub) => {
                const isDuplicateHash = (duplicatesMap.hashCounts.get(sub.fileSha256) || 0) > 1;

                return (
                  <tr
                    key={sub.id}
                    className="hover:bg-[#131923]/60 transition-colors"
                  >
                    {/* Customer */}
                    <td className="py-2 px-3 align-middle">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-white text-xs">
                            {sub.reservation.customerUsername ? `@${sub.reservation.customerUsername}` : 'Buyer'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-500 text-[9.5px] font-mono">
                            TG: {sub.reservation.customerTelegramId}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Campaign */}
                    <td className="py-2 px-3 align-middle">
                      <span
                        className="inline-block px-2 py-0.5 rounded-md bg-[#131923] border border-[#1a2230] text-slate-300 text-[10px] font-medium max-w-[160px] truncate"
                        title={sub.reservation.lotteryTitle}
                      >
                        {sub.reservation.lotteryTitle}
                      </span>
                    </td>

                    {/* Receipt Direct Preview */}
                    <td className="py-2 px-3 align-middle">
                      <button
                        type="button"
                        onClick={() => void handleOpenReview(sub)}
                        title="View and verify receipt"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9.5px] font-bold bg-[#0c251b] hover:bg-[#123c2a] text-emerald-400 border border-[#123c2a] hover:border-emerald-500/40 transition-colors shadow-sm active:scale-95 whitespace-nowrap"
                      >
                        <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>📷 Receipt</span>
                      </button>
                    </td>

                    {/* Tickets & Total */}
                    <td className="py-2 px-3 align-middle">
                      <div className="space-y-0.5">
                        <span className="font-extrabold text-emerald-400 text-[11px] block font-mono leading-tight">
                          {formatETB(sub.reservation.totalAmountMinor)}
                        </span>
                        <span className="text-[9.5px] text-slate-400 font-medium block">
                          {sub.reservation.ticketCount} {sub.reservation.ticketCount === 1 ? 'ticket' : 'tickets'}
                        </span>
                      </div>
                    </td>

                    {/* Status & Flags - Minimized, Single-Line Badges Consistent with Site Colors */}
                    <td className="py-2 px-3 align-middle">
                      <div className="flex flex-col gap-1 items-start">
                        {sub.status === 'SUBMITTED' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide bg-[#261a0c] text-amber-400 border border-[#422b13] shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                            PENDING REVIEW
                          </span>
                        ) : sub.status === 'APPROVED' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide bg-[#0c251b] text-emerald-400 border border-[#123c2a] shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                            APPROVED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide bg-rose-950/40 text-rose-400 border border-rose-900/50 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                            REJECTED
                          </span>
                        )}

                        {/* Fraud flags - Compact inline warning badges */}
                        {isDuplicateHash && (
                          <span
                            className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[8px] font-extrabold bg-rose-950/50 text-rose-300 border border-rose-800/60 truncate max-w-full"
                            title="Fraud Alert: Duplicate Image Screenshot File"
                          >
                            <AlertTriangle className="w-2 h-2 text-rose-400 shrink-0" />
                            DUPLICATE IMAGE
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Submitted At */}
                    <td className="py-2 px-3 align-middle text-[10px] text-slate-400 font-mono">
                      <div>
                        {new Date(sub.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                      <span className="text-slate-500 text-[9px] block font-mono">
                        {new Date(sub.createdAt).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>

                    {/* Actions - Minimized & Consistent with Emerald Identity */}
                    <td className="py-2 px-3 text-right align-middle">
                      <button
                        onClick={() => void handleOpenReview(sub)}
                        aria-label={sub.status === 'SUBMITTED' ? 'Review Submission' : 'View Details'}
                        className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-sm active:scale-95 shrink-0 ${
                          sub.status === 'SUBMITTED'
                            ? 'bg-[#0c251b] hover:bg-[#123c2a] text-emerald-400 border border-[#123c2a] hover:border-emerald-500/50 shadow-emerald-950/20'
                            : 'bg-[#131923] hover:bg-[#1a2230] text-slate-300 border border-[#1a2230]'
                        }`}
                      >
                        <Eye className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="whitespace-nowrap">{sub.status === 'SUBMITTED' ? 'Review Submission' : 'View Details'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pageSize > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 text-xs text-slate-400 pt-1">
          <div>
            Showing <span className="font-bold text-white font-mono">{startIndex + 1}</span> to{' '}
            <span className="font-bold text-white font-mono">{endIndex}</span> of{' '}
            <span className="font-bold text-white font-mono">{totalItems}</span> submissions
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-300 disabled:opacity-40 transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {getVisiblePages().map((pageNum, idx) =>
              pageNum === '...' ? (
                <span key={`dots-${idx}`} className="px-2 text-slate-600">
                  ...
                </span>
              ) : (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(Number(pageNum))}
                  className={`w-7 h-7 rounded-xl font-bold font-mono transition-colors ${
                    currentPage === pageNum
                      ? 'bg-[#0c251b] text-emerald-400 border border-[#123c2a]'
                      : 'bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-300'
                  }`}
                >
                  {pageNum}
                </button>
              )
            )}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-300 disabled:opacity-40 transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Full Evidence & Decision Modal */}
      {activeReviewItem && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-start justify-center p-2 sm:p-4 overflow-y-auto overscroll-contain pb-32 pt-2 sm:pt-6">
          <div className="w-full max-w-3xl bg-[#0e131b] border border-[#1a2230] rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden my-auto sm:my-4">
            {/* Sticky Modal Header with Back to Dashboard button */}
            <div className="sticky top-0 z-30 bg-[#0e131b]/95 backdrop-blur-md p-3.5 sm:p-4 border-b border-[#1a2230] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveReviewItem(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-slate-300 hover:text-white border border-[#1a2230] text-xs font-bold transition-colors shrink-0 active:scale-95 shadow-sm"
                  title="Return to Submissions Table"
                >
                  <ArrowLeft className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline">Back to Table</span>
                  <span className="sm:hidden">Back</span>
                </button>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs sm:text-sm font-black text-white truncate">Payment Evidence</span>
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-md bg-[#131923] border border-[#1a2230] text-emerald-400 font-bold shrink-0">
                      @{activeReviewItem.reservation.customerUsername || 'Customer'}
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                    {activeReviewItem.reservation.lotteryTitle} • {activeReviewItem.reservation.ticketCount} Tickets
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveReviewItem(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#1a2230] transition-colors shrink-0"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Scrollable Two Columns */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Image/File Evidence */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Receipt / Screenshot
                  </span>
                  {evidenceUrl && (
                    <a
                      href={evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                    >
                      <span>Open Full Size</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="rounded-2xl border border-[#1a2230] bg-[#080b10] overflow-hidden flex items-center justify-center min-h-[300px] relative p-2">
                  {isLoadingEvidence ? (
                    <div className="flex flex-col items-center justify-center p-8 text-slate-400 space-y-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                      <span className="text-xs">Generating secure signed preview URL...</span>
                    </div>
                  ) : evidenceUrl ? (
                    (activeReviewItem.mimeType.startsWith('image/') || !activeReviewItem.mimeType.includes('pdf')) && !evidenceError ? (
                      <div className="relative w-full flex flex-col items-center">
                        <img
                          src={evidenceUrl}
                          alt="Payment proof screenshot"
                          className="w-full h-auto max-h-[440px] object-contain rounded-xl"
                          onError={() => setEvidenceError(true)}
                        />
                      </div>
                    ) : evidenceError ? (
                      <div className="p-8 text-center space-y-3">
                        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
                        <p className="text-xs font-bold text-white">Receipt preview could not be displayed directly in-app</p>
                        <p className="text-[11px] text-slate-400">File is securely stored on server and can be viewed or downloaded:</p>
                        <div className="flex items-center justify-center gap-2 pt-1">
                          <a
                            href={evidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                          >
                            <span>Open Receipt in Tab</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={evidenceUrl}
                            download={activeReviewItem.originalFilename}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-slate-300 border border-[#1a2230] text-xs font-bold"
                          >
                            <span>Download File</span>
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center space-y-2">
                        <FileText className="w-12 h-12 text-slate-500 mx-auto" />
                        <p className="text-xs font-bold text-white">{activeReviewItem.originalFilename}</p>
                        <a
                          href={evidenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-xl bg-[#131923] text-xs font-bold text-emerald-400 border border-[#1a2230]"
                        >
                          <span>Open Document</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )
                  ) : (
                    <div className="text-slate-500 text-xs p-6 text-center">
                      Unable to render evidence. File signature may have expired.
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <div>SHA-256: <span className="font-mono text-slate-400">{activeReviewItem.fileSha256.substring(0, 16)}...</span></div>
                  <div>Private storage key: <span className="font-mono text-slate-400">{activeReviewItem.id}</span></div>
                </div>
              </div>

              {/* Right Column: Comparison, Reference & Decision Controls */}
              <div className="space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-[#080b10] border border-[#1a2230] space-y-2 text-xs">
                    <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">
                      Verification Details
                    </span>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Expected Total:</span>
                      <span className="font-extrabold text-emerald-400 text-sm font-mono">
                        {formatETB(activeReviewItem.reservation.totalAmountMinor)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Claimed Amount:</span>
                      <span className="font-bold text-white font-mono">
                        {activeReviewItem.claimedAmountMinor
                          ? formatETB(activeReviewItem.claimedAmountMinor)
                          : 'Not specified'}
                      </span>
                    </div>


                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Customer TG:</span>
                      <span className="font-mono text-slate-300">
                        {activeReviewItem.reservation.customerTelegramId}
                      </span>
                    </div>
                  </div>

                  {/* Mandatory Verification Tickbox (FR-21) */}
                  <div className="p-3.5 rounded-2xl bg-[#261a0c] border border-[#422b13] text-amber-200 text-xs space-y-2">
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        id="compared-checkbox"
                        checked={comparedWithBankRecord}
                        onChange={(e) => setComparedWithBankRecord(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-amber-500 text-emerald-500 focus:ring-emerald-400 cursor-pointer"
                      />
                      <label htmlFor="compared-checkbox" className="font-bold cursor-pointer text-xs leading-snug">
                        I confirm I have compared this evidence with the actual CBE / Telebirr bank record.
                      </label>
                    </div>
                    <p className="text-[10px] text-amber-400/80 pl-6">
                      Never approve solely on a screenshot. Check the bank app or account balance for matching reference and settlement.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Internal Audit Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="e.g. Verified on CBE Mobile App reference TX-9842"
                      className="w-full px-3 py-2 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-medium"
                    />
                  </div>
                </div>

                {/* Decision Actions */}
                {activeReviewItem.status === 'SUBMITTED' ? (
                  <div className="flex items-center gap-3 pt-3 border-t border-[#1a2230]">
                    <button
                      type="button"
                      onClick={() => setIsRejectModalOpen(true)}
                      disabled={isSubmittingDecision}
                      className="flex-1 py-3 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Reject Submission</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleApprove()}
                      disabled={isSubmittingDecision || !comparedWithBankRecord}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSubmittingDecision ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          <span>Approve Tickets</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 text-center bg-[#080b10] rounded-xl text-xs text-slate-400 font-medium">
                    This submission is already {activeReviewItem.status}.
                  </div>
                )}

                {/* Back to submissions button at bottom of review controls */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveReviewItem(null)}
                    className="w-full py-2.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-slate-300 hover:text-white border border-[#1a2230] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-98 shadow-sm"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                    <span>Back to Submissions Table</span>
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e131b] border border-rose-500/30 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-400 font-extrabold text-base">
              <AlertTriangle className="w-5 h-5" />
              <span>Reject Payment Proof</span>
            </div>
            <p className="text-xs text-slate-300">
              A clear rejection reason is mandatory. The buyer will receive this message in Telegram, and their held numbers will be released back to AVAILABLE.
            </p>

            <textarea
              rows={3}
              required
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Transaction reference not found on bank statement, or amount does not match ticket total."
              className="w-full p-3 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 font-medium"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#131923] border border-[#1a2230] text-slate-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReject()}
                disabled={isSubmittingDecision || !rejectReason.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmittingDecision ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge Campaign Payments Modal (Overload Safety) */}
      {isPurgeModalOpen && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0e131b] border border-rose-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#1a2230] pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-extrabold text-base">
                <Trash2 className="w-5 h-5 text-rose-400 shrink-0" />
                <span>Erase Single Campaign Payments & Reset</span>
              </div>
              <button
                type="button"
                onClick={() => setIsPurgeModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2230]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              In case the system becomes overloaded with high transaction volume, conflicting holds, or stalled payments, this tool safely clears payment records and restores ticket numbers back to <b className="text-emerald-400">AVAILABLE</b>.
            </p>

            {/* Target Campaign (Strictly Single Campaign) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                Target Single Campaign
              </label>
              <div className="p-3.5 rounded-2xl bg-[#080b10] border border-[#1a2230] flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-sm font-extrabold text-white">
                    {lotteries.find((l) => l.id === purgeTargetLotteryId)?.title || selectedCampaign || 'Single Campaign'}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    Campaign ID: <code className="text-slate-300">{purgeTargetLotteryId}</code>
                  </span>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#0c251b] text-emerald-400 border border-[#123c2a]">
                  Single Campaign
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/40 text-xs text-rose-300 leading-relaxed">
              ⚠️ <b>Strict Single-Campaign Scope:</b> This overload relief action deletes payment submissions and releases held tickets for <b>only this single campaign</b>. All other campaigns in the system will remain completely untouched.
            </div>

            {/* Purge Mode Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">
                Purge Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPurgeMode('ALL')}
                  className={`p-3 rounded-2xl border text-left transition-all space-y-1 ${
                    purgeMode === 'ALL'
                      ? 'bg-rose-950/60 border-rose-500 text-rose-200 shadow-md'
                      : 'bg-[#080b10] border-[#1a2230] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-extrabold text-xs">
                    <span className={`w-2.5 h-2.5 rounded-full ${purgeMode === 'ALL' ? 'bg-rose-400' : 'bg-slate-600'}`} />
                    <span>All Payments & Holds</span>
                  </div>
                  <p className="text-[10.5px] leading-tight text-slate-400">
                    Full wipe. Clears all submissions & reservations. Restores 100% of tickets back to AVAILABLE.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPurgeMode('PENDING_ONLY')}
                  className={`p-3 rounded-2xl border text-left transition-all space-y-1 ${
                    purgeMode === 'PENDING_ONLY'
                      ? 'bg-amber-950/60 border-amber-500 text-amber-200 shadow-md'
                      : 'bg-[#080b10] border-[#1a2230] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-extrabold text-xs">
                    <span className={`w-2.5 h-2.5 rounded-full ${purgeMode === 'PENDING_ONLY' ? 'bg-amber-400' : 'bg-slate-600'}`} />
                    <span>Pending / Unapproved Only</span>
                  </div>
                  <p className="text-[10.5px] leading-tight text-slate-400">
                    Removes only unreviewed submissions and held numbers. Keeps already confirmed tickets intact.
                  </p>
                </button>
              </div>
            </div>

            {/* Confirmation Safety Input */}
            <div className="p-3.5 rounded-2xl bg-[#080b10] border border-rose-900/40 space-y-2">
              <span className="text-[11px] text-slate-300 font-semibold block">
                To confirm, type <b className="text-rose-400 font-mono tracking-wider">PURGE</b> in the box below:
              </span>
              <input
                type="text"
                value={purgeConfirmText}
                onChange={(e) => setPurgeConfirmText(e.target.value)}
                placeholder="Type PURGE to confirm"
                className="w-full px-3 py-2 rounded-xl bg-[#0e131b] border border-rose-900/60 text-xs font-mono font-bold text-white uppercase placeholder-slate-600 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsPurgeModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-[#131923] border border-[#1a2230] text-slate-300 font-bold text-xs hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleExecutePurge()}
                disabled={isPurging || purgeConfirmText.toUpperCase() !== 'PURGE' || !purgeTargetLotteryId}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs flex items-center gap-2 disabled:opacity-40 shadow-lg shadow-rose-900/40 transition-all active:scale-95"
              >
                {isPurging ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Confirm & Erase Payments</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
