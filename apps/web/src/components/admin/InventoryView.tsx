import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  Lock,
  Eye,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AdminLottery, NumberInventoryItem, NumberStatus } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

interface InventoryViewProps {
  initialLotteryId?: string;
  initialLotteryTitle?: string;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  initialLotteryId,
  initialLotteryTitle: _initialLotteryTitle,
}) => {
  const [campaigns, setCampaigns] = useState<AdminLottery[]>([]);
  const [selectedLotteryId, setSelectedLotteryId] = useState<string>(initialLotteryId || '');
  const [inventory, setInventory] = useState<NumberInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchNumber, setSearchNumber] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Sync with prop when navigating from Campaigns inspect
  useEffect(() => {
    if (initialLotteryId) {
      setSelectedLotteryId(initialLotteryId);
    }
  }, [initialLotteryId]);

  // Load campaigns list for selector
  useEffect(() => {
    void api
      .getAdminLotteries()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setCampaigns(list);
        if (!selectedLotteryId && list.length > 0) {
          setSelectedLotteryId(initialLotteryId || list[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load campaigns'));
  }, [initialLotteryId, selectedLotteryId]);

  const fetchInventory = useCallback(async () => {
    if (!selectedLotteryId) return;
    setIsLoading(true);
    setError(null);
    try {
      const searchVal = searchNumber.trim() ? parseInt(searchNumber.trim(), 10) : undefined;
      const statusVal = statusFilter !== 'ALL' ? (statusFilter as NumberStatus) : undefined;
      const data = await api.getLotteryInventory(selectedLotteryId, statusVal, searchVal);
      setInventory(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load number inventory');
    } finally {
      setIsLoading(false);
    }
  }, [selectedLotteryId, statusFilter, searchNumber]);

  useEffect(() => {
    if (selectedLotteryId) {
      void fetchInventory();
    }
  }, [selectedLotteryId, fetchInventory]);

  // Reset to first page when campaign, filters, or page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLotteryId, statusFilter, searchNumber, pageSize]);

  const totalItems = inventory.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedInventory = inventory.slice(startIndex, endIndex);

  const getVisiblePages = () => {
    const delta = 2;
    const range: (number | string)[] = [];
    const left = Math.max(2, currentPage - delta);
    const right = Math.min(totalPages - 1, currentPage + delta);

    range.push(1);
    if (left > 2) {
      range.push('...');
    }
    for (let i = left; i <= right; i++) {
      range.push(i);
    }
    if (right < totalPages - 1) {
      range.push('...');
    }
    if (totalPages > 1) {
      range.push(totalPages);
    }
    return range;
  };

  const getStatusBadge = (status: NumberStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            AVAILABLE
          </span>
        );
      case 'HELD':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            HELD
          </span>
        );
      case 'PENDING_REVIEW':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Eye className="w-3 h-3" />
            PENDING REVIEW
          </span>
        );
      case 'RESERVED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-400 border border-slate-700">
            <Lock className="w-3 h-3" />
            RESERVED / SOLD
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Number Inventory Inspector</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Inspect live claims, hold expiry, and owner allocations per ticket number
          </p>
        </div>
        <button
          onClick={() => void fetchInventory()}
          disabled={isLoading || !selectedLotteryId}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh Inventory</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Campaign Selector & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900/60 p-4 rounded-3xl border border-slate-800">
        {/* Campaign Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Selected Campaign
          </label>
          <select
            value={selectedLotteryId}
            onChange={(e) => setSelectedLotteryId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-medium focus:outline-none focus:border-emerald-500"
          >
            {(Array.isArray(campaigns) ? campaigns : []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.status})
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Status Filter
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-medium focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="AVAILABLE">AVAILABLE</option>
            <option value="HELD">HELD</option>
            <option value="PENDING_REVIEW">PENDING REVIEW</option>
            <option value="RESERVED">RESERVED (Confirmed)</option>
          </select>
        </div>

        {/* Search Number */}
        <div>
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Search Number
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="number"
              placeholder="e.g. 42"
              value={searchNumber}
              onChange={(e) => setSearchNumber(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Quick Summary & Page Size Controls */}
      {!isLoading && inventory.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">
              Showing <span className="font-bold text-white">{totalItems === 0 ? 0 : startIndex + 1}</span>–
              <span className="font-bold text-white">{endIndex}</span> of{' '}
              <span className="font-bold text-emerald-400">{totalItems}</span> numbers
            </span>
            <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-3 border-l border-slate-800 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {inventory.filter((i) => i.status === 'AVAILABLE').length} Available
              </span>
              <span className="inline-flex items-center gap-1 text-amber-400 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {inventory.filter((i) => i.status === 'HELD' || i.status === 'PENDING_REVIEW').length} Held
              </span>
              <span className="inline-flex items-center gap-1 text-slate-400 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                {inventory.filter((i) => i.status === 'RESERVED').length} Reserved
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Per Page:</span>
            <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-950 border border-slate-800">
              {[20, 40, 100].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPageSize(size)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    pageSize === size
                      ? 'bg-emerald-500 text-black shadow-sm font-extrabold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading && inventory.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading number inventory"
          subtitle="Scanning ticket allocations, reservations, and claimed numbers"
        />
      ) : inventory.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-3xl border border-slate-800 text-slate-400 text-xs">
          No inventory numbers found for this campaign or filter.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-black/20">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Number</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Active Claim / Reservation</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Hold / Expiry Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {paginatedInventory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-white text-sm">
                      #{typeof item.numberValue === 'number' ? item.numberValue.toString().padStart(4, '0') : (item.numberValue ? String(item.numberValue) : '—')}
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(item.status)}</td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {item.activeClaim ? (
                        <span className="text-indigo-400 font-bold">
                          {item.activeClaim.reservationReference}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {item.activeClaim ? (
                        <div>
                          <div className="font-semibold text-white">
                            {item.activeClaim.customerUsername ? `@${item.activeClaim.customerUsername}` : 'Customer'}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            TG ID: {item.activeClaim.customerTelegramId}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {item.activeClaim?.heldUntil ? (
                        <span className="text-amber-400 font-mono">
                          {new Date(item.activeClaim.heldUntil).toLocaleTimeString()}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Navigation Footer */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-3xl border border-slate-800 bg-slate-900/60 shadow-lg">
              <div className="text-xs text-slate-400">
                Page <span className="font-bold text-white">{currentPage}</span> of{' '}
                <span className="font-bold text-white">{totalPages}</span>{' '}
                <span className="text-slate-600">({totalItems} numbers total)</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* First Page */}
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  title="First Page"
                  className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border border-slate-800 transition-colors"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>

                {/* Previous Page */}
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed border border-slate-800 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                {/* Page numbers */}
                <div className="flex items-center gap-1">
                  {getVisiblePages().map((pageNum, idx) => {
                    if (pageNum === '...') {
                      return (
                        <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-slate-600 font-bold">
                          ...
                        </span>
                      );
                    }
                    const num = pageNum as number;
                    const isActive = currentPage === num;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setCurrentPage(num)}
                        className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold transition-all ${
                          isActive
                            ? 'bg-emerald-500 text-black font-extrabold shadow-md shadow-emerald-500/20'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>

                {/* Next Page with dynamic page size label */}
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs shadow-md shadow-emerald-500/20 transition-all disabled:opacity-30 disabled:bg-slate-950 disabled:text-slate-600 disabled:shadow-none disabled:cursor-not-allowed border border-emerald-500/30 disabled:border-slate-800"
                >
                  <span>Next {pageSize}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Last Page */}
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  title="Last Page"
                  className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border border-slate-800 transition-colors"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
