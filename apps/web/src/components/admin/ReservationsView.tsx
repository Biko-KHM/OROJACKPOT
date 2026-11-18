import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Clock,
  Ticket,
  User,
  Layers,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AdminReservationItem } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

export const ReservationsView: React.FC = () => {
  const [reservations, setReservations] = useState<AdminReservationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Creative Pagination State
  const [pageSize, setPageSize] = useState<number>(8);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Detail Inspector Modal with Next / Back Reservation Stepper
  const [inspectIndex, setInspectIndex] = useState<number | null>(null);

  const fetchReservations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const statusVal = statusFilter !== 'ALL' ? statusFilter : undefined;
      const data = await api.getAdminReservations(statusVal, searchQuery.trim() || undefined);
      setReservations(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reservations');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchReservations();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchReservations]);

  // Reset page when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, searchQuery, pageSize]);

  // Pagination Calculations
  const totalCount = reservations.length;
  const totalPages = pageSize > 0 ? Math.ceil(totalCount / pageSize) || 1 : 1;
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedReservations = useMemo(() => {
    if (pageSize <= 0) return reservations;
    const start = (validPage - 1) * pageSize;
    return reservations.slice(start, start + pageSize);
  }, [reservations, validPage, pageSize]);

  const startRecord = totalCount === 0 ? 0 : (validPage - 1) * (pageSize > 0 ? pageSize : totalCount) + 1;
  const endRecord = pageSize > 0 ? Math.min(validPage * pageSize, totalCount) : totalCount;

  const handlePrevPage = () => {
    if (validPage > 1) setCurrentPage(validPage - 1);
  };

  const handleNextPage = () => {
    if (validPage < totalPages) setCurrentPage(validPage + 1);
  };

  // Active inspected reservation
  const activeReservation = inspectIndex !== null && reservations[inspectIndex] ? reservations[inspectIndex] : null;

  // Next / Back handlers for detail inspector
  const handlePrevReservation = useCallback(() => {
    if (inspectIndex !== null && inspectIndex > 0) {
      setInspectIndex(inspectIndex - 1);
    }
  }, [inspectIndex]);

  const handleNextReservation = useCallback(() => {
    if (inspectIndex !== null && inspectIndex < reservations.length - 1) {
      setInspectIndex(inspectIndex + 1);
    }
  }, [inspectIndex, reservations.length]);

  // Keyboard navigation for detail inspector (Left/Right arrows to flip, Esc to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (inspectIndex === null) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevReservation();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextReservation();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInspectIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectIndex, handlePrevReservation, handleNextReservation]);

  const copyCode = (code: string) => {
    void navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatETB = (minor: string): string => {
    const num = Number(BigInt(minor)) / 100;
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-[#0c251b] text-emerald-400 border border-[#123c2a] shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            CONFIRMED
          </span>
        );
      case 'PENDING_REVIEW':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-purple-950/40 text-purple-400 border border-purple-900/50 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
            PENDING REVIEW
          </span>
        );
      case 'AWAITING_PAYMENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-[#261a0c] text-amber-400 border border-[#422b13] shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            AWAITING PAYMENT
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-rose-950/40 text-rose-400 border border-rose-900/50 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
            REJECTED
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-slate-900 text-slate-400 border border-slate-800 shrink-0">
            EXPIRED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-extrabold bg-slate-900 text-slate-500 border border-slate-800 shrink-0">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[9.5px] bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#1a2230]">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Reservations Search & Audit</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time status tracking for customer ticket holds, payments, and settlements
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => void fetchReservations()}
            disabled={isLoading}
            className="p-2 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-300 hover:text-emerald-400 transition-colors"
            title="Refresh reservations"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0e131b] p-3 rounded-2xl border border-[#1a2230]">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0 text-xs">
          {['ALL', 'CONFIRMED', 'PENDING_REVIEW', 'AWAITING_PAYMENT', 'REJECTED', 'EXPIRED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                  : 'bg-[#131923] text-slate-400 hover:text-white hover:bg-[#1a2230] border border-[#1a2230]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reference or @username..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Compact Shorter Reservations Table */}
      {isLoading && reservations.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading reservations"
          subtitle="Querying hold states, customer accounts, and countdown timers"
        />
      ) : reservations.length === 0 ? (
        <div className="text-center py-12 bg-[#0e131b]/60 rounded-2xl border border-[#1a2230] text-slate-400 text-xs">
          No reservations found matching the search criteria.
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Header Quick Navigator */}
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-slate-400 text-[11px]">
              Showing <span className="text-white font-bold">{startRecord}</span> –{' '}
              <span className="text-white font-bold">{endRecord}</span> of{' '}
              <span className="text-emerald-400 font-extrabold">{totalCount}</span> reservations
            </span>

            {/* Quick Next / Back stepper */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePrevPage}
                disabled={validPage <= 1}
                className="px-2 py-1 rounded-lg bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-[11px] font-bold text-slate-300 disabled:opacity-40 disabled:hover:bg-[#0e131b] flex items-center gap-1 transition-all"
                title="Previous page"
              >
                <ChevronLeft className="w-3 h-3 text-emerald-400" />
                <span>Back</span>
              </button>
              <span className="px-2 py-1 rounded-lg bg-[#080b10] border border-[#1a2230] text-[10.5px] font-mono text-slate-300 font-bold">
                {validPage} / {totalPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={validPage >= totalPages}
                className="px-2 py-1 rounded-lg bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-[11px] font-bold text-slate-300 disabled:opacity-40 disabled:hover:bg-[#0e131b] flex items-center gap-1 transition-all"
                title="Next page"
              >
                <span>Next</span>
                <ChevronRight className="w-3 h-3 text-emerald-400" />
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-hidden rounded-2xl border border-[#1a2230] bg-[#0e131b] shadow-xl">
            <table className="w-full text-left border-collapse table-fixed">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[15%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[13%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#1a2230] bg-[#080b10]/95 text-slate-400 font-bold uppercase tracking-wider text-[9px] sm:text-[9.5px]">
                  <th className="py-2.5 px-3">Reference</th>
                  <th className="py-2.5 px-2.5">Status</th>
                  <th className="py-2.5 px-2.5">Campaign</th>
                  <th className="py-2.5 px-2.5">Customer</th>
                  <th className="py-2.5 px-2.5">Tickets</th>
                  <th className="py-2.5 px-2.5">Total Amount</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a2230]/70">
                {paginatedReservations.map((res, index) => {
                  const absoluteIndex = pageSize > 0 ? (validPage - 1) * pageSize + index : index;

                  return (
                    <tr
                      key={res.id}
                      onClick={() => setInspectIndex(absoluteIndex)}
                      className="hover:bg-[#131923]/60 transition-colors cursor-pointer group"
                    >
                      {/* Reference */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-mono font-bold text-white text-[11px] truncate">
                            {res.publicReference}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyCode(res.publicReference);
                            }}
                            className="text-slate-500 hover:text-emerald-400 transition-colors p-0.5 shrink-0"
                            title="Copy reference code"
                          >
                            {copiedCode === res.publicReference ? (
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-2 px-2.5">
                        {getStatusBadge(res.status)}
                      </td>

                      {/* Campaign */}
                      <td className="py-2 px-2.5">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded-md bg-[#131923] border border-[#1a2230] text-slate-300 text-[10px] font-medium max-w-full truncate"
                          title={res.lottery.title}
                        >
                          {res.lottery.title}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="py-2 px-2.5">
                        <div className="truncate">
                          <div className="font-semibold text-white text-[10.5px] truncate">
                            {res.user.username ? `@${res.user.username}` : 'Customer'}
                          </div>
                          <div className="text-[9px] text-slate-500 font-mono">
                            TG: {res.user.telegramUserId}
                          </div>
                        </div>
                      </td>

                      {/* Tickets */}
                      <td className="py-2 px-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] font-extrabold text-white">
                            {res.ticketCount} {res.ticketCount === 1 ? 'ticket' : 'tickets'}
                          </span>
                          <div className="flex items-center gap-0.5">
                            {res.items.slice(0, 2).map((item) => (
                              <span
                                key={item.lotteryNumberId}
                                className="px-1 py-0.2 rounded bg-[#131923] text-[8.5px] font-mono text-emerald-400 border border-[#1a2230]"
                              >
                                #{item.numberValue}
                              </span>
                            ))}
                            {res.items.length > 2 && (
                              <span className="text-[8.5px] text-slate-500 font-bold">
                                +{res.items.length - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Total Amount */}
                      <td className="py-2 px-2.5 font-mono font-bold text-emerald-400 text-[11px]">
                        {formatETB(res.totalAmountMinor)}
                      </td>

                      {/* Quick Inspect Details Button */}
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectIndex(absoluteIndex);
                          }}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-[#0c251b] hover:bg-[#123c2a] text-emerald-400 border border-[#123c2a] text-[10.5px] font-bold shadow-sm transition-all active:scale-95 group-hover:border-emerald-500/50"
                        >
                          <Eye className="w-3 h-3 text-emerald-400" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Creative Bottom Pagination Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 px-1">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">Rows per view:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 rounded-lg bg-[#080b10] border border-[#1a2230] text-[11px] text-slate-300 font-medium focus:outline-none focus:border-emerald-500"
              >
                <option value={6}>6 rows (compact)</option>
                <option value={8}>8 rows</option>
                <option value={12}>12 rows</option>
                <option value={20}>20 rows</option>
                <option value={0}>All rows</option>
              </select>
            </div>

            {/* Creative Next / Back Navigation Buttons */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  onClick={handlePrevPage}
                  disabled={validPage <= 1}
                  className="px-3 py-1.5 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:bg-[#0e131b] flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Previous</span>
                </button>

                {/* Page Jump Pills */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - validPage) <= 1)
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const hasGap = prev && p - prev > 1;

                      return (
                        <React.Fragment key={p}>
                          {hasGap && <span className="text-slate-600 px-1 text-xs">…</span>}
                          <button
                            onClick={() => setCurrentPage(p)}
                            className={`w-7 h-7 rounded-lg text-xs font-bold font-mono transition-all ${
                              p === validPage
                                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/30'
                                : 'bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-slate-400 hover:text-white'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  onClick={handleNextPage}
                  disabled={validPage >= totalPages}
                  className="px-3 py-1.5 rounded-xl bg-[#0e131b] hover:bg-[#131923] border border-[#1a2230] text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:bg-[#0e131b] flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Creative Reservation Detail Inspector Modal with Next / Back Navigation */}
      {activeReservation && inspectIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#0e131b] border border-[#1a2230] rounded-3xl p-6 shadow-2xl space-y-5 my-8">
            {/* Modal Header: Navigation and Index */}
            <div className="flex items-center justify-between pb-3 border-b border-[#1a2230]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-emerald-400">
                  <Ticket className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">Reservation Details</h3>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Entry {inspectIndex + 1} of {reservations.length}
                  </span>
                </div>
              </div>

              {/* Next / Back stepper in Modal Header */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePrevReservation}
                  disabled={inspectIndex <= 0}
                  className="p-1.5 rounded-lg bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:bg-[#131923] transition-all"
                  title="Previous reservation (Left arrow key)"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
                </button>
                <button
                  type="button"
                  onClick={handleNextReservation}
                  disabled={inspectIndex >= reservations.length - 1}
                  className="p-1.5 rounded-lg bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:bg-[#131923] transition-all"
                  title="Next reservation (Right arrow key)"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                </button>
                <button
                  type="button"
                  onClick={() => setInspectIndex(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#131923] transition-colors ml-1"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Reference & Status Hero Card */}
            <div className="p-4 rounded-2xl bg-[#080b10] border border-[#1a2230] flex items-center justify-between gap-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider mb-0.5">
                  Public Reference Code
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-extrabold text-white">
                    {activeReservation.publicReference}
                  </span>
                  <button
                    onClick={() => copyCode(activeReservation.publicReference)}
                    className="p-1 rounded-md text-slate-400 hover:text-emerald-400 transition-colors"
                    title="Copy code"
                  >
                    {copiedCode === activeReservation.publicReference ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="shrink-0">{getStatusBadge(activeReservation.status)}</div>
            </div>

            {/* Meta Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-[#080b10] border border-[#1a2230]">
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                  <Layers className="w-3 h-3 text-emerald-400" />
                  <span>Campaign</span>
                </div>
                <div className="font-bold text-white text-xs truncate">
                  {activeReservation.lottery.title}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  /{activeReservation.lottery.slug}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-[#080b10] border border-[#1a2230]">
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                  <User className="w-3 h-3 text-emerald-400" />
                  <span>Customer</span>
                </div>
                <div className="font-bold text-white text-xs truncate">
                  {activeReservation.user.username ? `@${activeReservation.user.username}` : 'Direct Customer'}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  TG: {activeReservation.user.telegramUserId}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-[#080b10] border border-[#1a2230]">
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                  <Ticket className="w-3 h-3 text-emerald-400" />
                  <span>Total Amount</span>
                </div>
                <div className="font-mono font-extrabold text-emerald-400 text-sm">
                  {formatETB(activeReservation.totalAmountMinor)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {activeReservation.ticketCount} tickets
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-[#080b10] border border-[#1a2230]">
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Submissions</span>
                </div>
                <div className="font-bold text-white text-xs">
                  {activeReservation.paymentSubmissionsCount} payment proof(s)
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {activeReservation.submittedAt
                    ? `Paid: ${new Date(activeReservation.submittedAt).toLocaleTimeString()}`
                    : 'Awaiting payment proof'}
                </div>
              </div>
            </div>

            {/* Held Ticket Numbers Display */}
            <div className="p-3.5 rounded-2xl bg-[#080b10] border border-[#1a2230] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10.5px] font-bold text-slate-300">
                  Reserved Numbers ({activeReservation.items.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {formatETB(activeReservation.totalAmountMinor)} total
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {activeReservation.items.map((item) => (
                  <span
                    key={item.lotteryNumberId}
                    className="px-2 py-0.5 rounded-lg bg-[#0c251b] border border-[#123c2a] text-xs font-mono font-bold text-emerald-400 shadow-sm"
                  >
                    #{item.numberValue}
                  </span>
                ))}
              </div>
            </div>

            {/* Timeline Notes */}
            <div className="p-3 rounded-2xl bg-[#080b10]/60 border border-[#1a2230] text-[11px] text-slate-400 space-y-1">
              {activeReservation.holdExpiresAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Hold Expiration:</span>
                  <span className="font-mono text-amber-400">
                    {new Date(activeReservation.holdExpiresAt).toLocaleString()}
                  </span>
                </div>
              )}
              {activeReservation.submittedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Payment Submitted:</span>
                  <span className="font-mono text-slate-300">
                    {new Date(activeReservation.submittedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {activeReservation.reviewedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Admin Reviewed:</span>
                  <span className="font-mono text-emerald-400">
                    {new Date(activeReservation.reviewedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Modal Footer Stepper Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-[#1a2230]">
              <button
                type="button"
                onClick={handlePrevReservation}
                disabled={inspectIndex <= 0}
                className="px-3.5 py-2 rounded-xl bg-[#131923] hover:bg-[#1a2230] border border-[#1a2230] text-slate-200 text-xs font-bold flex items-center gap-1.5 disabled:opacity-30 disabled:hover:bg-[#131923] transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
                <span>Previous</span>
                <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">[←]</span>
              </button>

              <button
                type="button"
                onClick={() => setInspectIndex(null)}
                className="px-4 py-2 rounded-xl bg-[#1a2230] hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleNextReservation}
                disabled={inspectIndex >= reservations.length - 1}
                className="px-3.5 py-2 rounded-xl bg-[#0c251b] hover:bg-[#123c2a] border border-[#123c2a] text-emerald-400 text-xs font-bold flex items-center gap-1.5 disabled:opacity-30 disabled:hover:bg-[#0c251b] transition-all shadow-sm shadow-emerald-950/20"
              >
                <span>Next</span>
                <span className="text-[10px] text-emerald-600 font-mono hidden sm:inline">[→]</span>
                <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
