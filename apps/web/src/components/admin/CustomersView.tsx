import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Clock,
  CheckCircle2,
  XCircle,
  Trophy,
  Eye,
  ExternalLink,
  ChevronRight,
  Copy,
  Check,
  ArrowUpDown,
  X,
  History,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AdminCustomerItem, CustomerDetail } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

interface CustomersViewProps {
  onNavigateToAudit?: (userId: string, userName?: string) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ onNavigateToAudit }) => {
  const [customers, setCustomers] = useState<AdminCustomerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'BLOCKED' | 'WITH_TICKETS' | 'WITH_HOLDS'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'totalSpent' | 'confirmedTickets' | 'totalReservations' | 'activeHolds'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [error, setError] = useState<string | null>(null);

  // Customer 360 Detail Modal State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'reservations' | 'audit' | 'wins'>('overview');

  // Block/Unblock Confirmation Modal
  const [blockTarget, setBlockTarget] = useState<AdminCustomerItem | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [isSubmittingBlock, setIsSubmittingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Copy feedback state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getAdminCustomers({
        search: searchQuery.trim() || undefined,
        status: statusFilter,
        sortBy,
        sortOrder,
      });
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customers');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchCustomers();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchCustomers]);

  // Fetch customer detail when selectedCustomerId changes
  const fetchCustomerDetail = useCallback(async (id: string) => {
    setIsLoadingDetail(true);
    try {
      const detail = await api.getCustomerDetail(id);
      setCustomerDetail(detail);
    } catch (err) {
      console.error('Failed to load customer profile details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const handleOpenCustomerDetail = (id: string) => {
    setSelectedCustomerId(id);
    setDetailTab('overview');
    void fetchCustomerDetail(id);
  };

  const handleCloseCustomerDetail = () => {
    setSelectedCustomerId(null);
    setCustomerDetail(null);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleToggleBlockConfirm = async () => {
    if (!blockTarget) return;
    setIsSubmittingBlock(true);
    setBlockError(null);
    const newStatus = !blockTarget.isBlocked;
    try {
      await api.toggleBlockCustomer(blockTarget.id, newStatus, blockReason.trim() || undefined);
      // Update local state in table
      setCustomers((prev) =>
        prev.map((c) => (c.id === blockTarget.id ? { ...c, isBlocked: newStatus } : c)),
      );
      // Update detail if open
      if (customerDetail && customerDetail.id === blockTarget.id) {
        setCustomerDetail((prev) => (prev ? { ...prev, isBlocked: newStatus } : null));
      }
      setBlockTarget(null);
      setBlockReason('');
    } catch (err: unknown) {
      setBlockError(err instanceof Error ? err.message : 'Failed to update customer status');
    } finally {
      setIsSubmittingBlock(false);
    }
  };

  const formatETB = (minor: string | number): string => {
    try {
      const num = Number(BigInt(minor)) / 100;
      return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
    } catch {
      return '0.00 ETB';
    }
  };

  // Helper avatar background colors based on user name/id
  const getAvatarGradient = (seed: string): string => {
    const colors = [
      'from-emerald-500/80 to-teal-700/80',
      'from-cyan-500/80 to-blue-700/80',
      'from-indigo-500/80 to-violet-700/80',
      'from-purple-500/80 to-pink-700/80',
      'from-amber-500/80 to-orange-700/80',
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (firstName?: string | null, lastName?: string | null, username?: string | null): string => {
    if (firstName && firstName.trim()) {
      return (firstName[0] + (lastName && lastName[0] ? lastName[0] : '')).toUpperCase();
    }
    if (username && username.trim()) {
      return username.slice(0, 2).toUpperCase();
    }
    return 'TG';
  };

  // Aggregated KPI Stats
  const totalCustomersCount = customers.length;
  const activeCustomersCount = customers.filter((c) => !c.isBlocked).length;
  const blockedCustomersCount = customers.filter((c) => c.isBlocked).length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">Customer Accounts & Activity</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {totalCustomersCount} PLAYERS • {activeCustomersCount} ACTIVE
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Registered Telegram players, live reservations, lifetime ticket spend, and complete player audit trail
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={() => void fetchCustomers()}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors text-xs font-semibold shadow-sm active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh Players</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Search Controls Toolbar */}
      <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username, full name, or Telegram ID..."
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${statusFilter === 'ALL'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
          >
            All ({totalCustomersCount})
          </button>
          <button
            onClick={() => setStatusFilter('ACTIVE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${statusFilter === 'ACTIVE'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
          >
            Active ({activeCustomersCount})
          </button>
          <button
            onClick={() => setStatusFilter('BLOCKED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${statusFilter === 'BLOCKED'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
          >
            Blocked ({blockedCustomersCount})
          </button>
          <button
            onClick={() => setStatusFilter('WITH_TICKETS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${statusFilter === 'WITH_TICKETS'
              ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-sm'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
          >
            With Tickets
          </button>
          <button
            onClick={() => setStatusFilter('WITH_HOLDS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${statusFilter === 'WITH_HOLDS'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
          >
            Active Holds
          </button>
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 pr-8 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 appearance-none font-medium cursor-pointer"
            >
              <option value="createdAt">Newest Joined</option>
              <option value="totalSpent">Highest Spend (ETB)</option>
              <option value="confirmedTickets">Most Confirmed Tickets</option>
              <option value="activeHolds">Most Active Holds</option>
              <option value="totalReservations">Total Reservations</option>
            </select>
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors"
            title={sortOrder === 'desc' ? 'Sort Descending' : 'Sort Ascending'}
          >
            <span className="text-xs font-bold font-mono">{sortOrder.toUpperCase()}</span>
          </button>
        </div>
      </div>

      {/* Well-Structured Customers Table */}
      {isLoading && customers.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading customer profiles"
          subtitle="Querying player accounts, Telegram IDs, and ticket volumes"
        />
      ) : customers.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/40 rounded-3xl border border-slate-800 text-slate-400 text-xs">
          <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="font-bold text-white text-sm">No customer records found</div>
          <p className="text-slate-500 mt-1">Try adjusting your search criteria or filter pills above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60 shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Customer Player</th>
                <th className="py-3.5 px-4">Telegram ID</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-center">Active Holds</th>
                <th className="py-3.5 px-4 text-center">Confirmed Tickets</th>
                <th className="py-3.5 px-4 text-right">Lifetime Spend</th>
                <th className="py-3.5 px-4">Joined Date</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {customers.map((c) => {
                const displayName =
                  c.firstName || c.lastName
                    ? `${c.firstName || ''} ${c.lastName || ''}`.trim()
                    : c.username || `Player #${c.telegramUserId}`;
                const initials = getInitials(c.firstName, c.lastName, c.username);
                const gradient = getAvatarGradient(c.id);

                return (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => handleOpenCustomerDetail(c.id)}
                  >
                    {/* Customer Info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-2xl bg-gradient-to-tr ${gradient} flex items-center justify-center font-black text-white text-xs shadow-md shrink-0 relative`}
                        >
                          {initials}
                          <span
                            className={`w-2.5 h-2.5 rounded-full absolute -top-0.5 -right-0.5 border-2 border-slate-900 ${c.isBlocked ? 'bg-rose-500' : 'bg-emerald-400'
                              }`}
                          />
                        </div>
                        <div>
                          <div className="font-bold text-white text-sm group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                            <span>{displayName}</span>
                            {c.isBlocked && (
                              <span className="text-[9px] font-black text-rose-400 bg-rose-500/10 px-1.5 py-0.2 rounded border border-rose-500/20">
                                BANNED
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {c.username ? (
                              <span className="text-xs text-emerald-400/90 font-medium font-mono">
                                @{c.username}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 font-mono">No username</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Telegram ID */}
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-300 text-xs bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                          {c.telegramUserId}
                        </span>
                        <button
                          onClick={() => handleCopy(c.telegramUserId, `tg-${c.id}`)}
                          className="p-1 rounded-md text-slate-500 hover:text-white transition-colors"
                          title="Copy Telegram ID"
                        >
                          {copiedId === `tg-${c.id}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4 text-center">
                      {c.isBlocked ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/40 shadow-sm">
                          <XCircle className="w-3 h-3 text-rose-400" />
                          BLOCKED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ACTIVE
                        </span>
                      )}
                    </td>

                    {/* Active Holds */}
                    <td className="py-3 px-4 text-center">
                      {c.activeHolds > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <Clock className="w-3 h-3 animate-spin text-amber-400" />
                          {c.activeHolds} active
                        </span>
                      ) : (
                        <span className="font-mono text-slate-500 text-xs">0</span>
                      )}
                    </td>

                    {/* Confirmed Tickets */}
                    <td className="py-3 px-4 text-center">
                      {c.confirmedTickets > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-white border border-emerald-500/30">
                          <Ticket className="w-3 h-3 text-emerald-400" />
                          {c.confirmedTickets}
                        </span>
                      ) : (
                        <span className="font-mono text-slate-500 text-xs">0</span>
                      )}
                    </td>

                    {/* Lifetime Spend */}
                    <td className="py-3 px-4 text-right">
                      <div className="font-mono font-bold text-emerald-400 text-xs">
                        {formatETB(c.totalSpentMinor)}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {c.totalReservations} reservations
                      </div>
                    </td>

                    {/* Joined Date */}
                    <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>

                    {/* Quick Row Actions */}
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenCustomerDetail(c.id)}
                          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                          title="View Customer 360 Profile"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {onNavigateToAudit && (
                          <button
                            onClick={() => onNavigateToAudit(c.id, c.username || displayName)}
                            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 transition-colors"
                            title="View Player Audit History"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setBlockTarget(c);
                            setBlockReason('');
                            setBlockError(null);
                          }}
                          className={`p-1.5 rounded-lg transition-colors border ${c.isBlocked
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                            }`}
                          title={c.isBlocked ? 'Unblock Player Account' : 'Block Player Account'}
                        >
                          {c.isBlocked ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer 360 Full Profile Drawer / Modal */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-700 flex items-center justify-center font-black text-white text-sm shadow-md">
                  {customerDetail ? getInitials(customerDetail.firstName, customerDetail.lastName, customerDetail.username) : 'TG'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-white tracking-tight">
                      {customerDetail
                        ? customerDetail.firstName || customerDetail.lastName
                          ? `${customerDetail.firstName || ''} ${customerDetail.lastName || ''}`.trim()
                          : customerDetail.username || `Player #${customerDetail.telegramUserId}`
                        : 'Customer Profile 360'}
                    </h3>
                    {customerDetail && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${customerDetail.isBlocked
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                      >
                        {customerDetail.isBlocked ? 'BLOCKED' : 'ACTIVE'}
                      </span>
                    )}
                  </div>
                  {customerDetail && (
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                      {customerDetail.username && (
                        <span className="text-emerald-400 font-bold">@{customerDetail.username}</span>
                      )}
                      <span>•</span>
                      <span>TG: {customerDetail.telegramUserId}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {customerDetail && (
                  <button
                    onClick={() => {
                      const item = customers.find((c) => c.id === customerDetail.id) || {
                        id: customerDetail.id,
                        telegramUserId: customerDetail.telegramUserId,
                        username: customerDetail.username,
                        firstName: customerDetail.firstName,
                        lastName: customerDetail.lastName,
                        isBlocked: customerDetail.isBlocked,
                        totalReservations: customerDetail.stats.totalReservations,
                        confirmedTickets: customerDetail.stats.confirmedTickets,
                        activeHolds: customerDetail.stats.activeHolds,
                        expiredReservations: customerDetail.stats.expiredReservations,
                        totalSpentMinor: customerDetail.stats.totalSpentMinor,
                        createdAt: customerDetail.createdAt,
                      };
                      setBlockTarget(item);
                      setBlockReason('');
                      setBlockError(null);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border flex items-center gap-1.5 ${customerDetail.isBlocked
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                      }`}
                  >
                    {customerDetail.isBlocked ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    <span>{customerDetail.isBlocked ? 'Unblock Player' : 'Block Player'}</span>
                  </button>
                )}
                <button
                  onClick={handleCloseCustomerDetail}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            {isLoadingDetail || !customerDetail ? (
              <div className="p-12">
                <CustomLoader fullScreen={false} message="Loading Customer 360" subtitle="Aggregating tickets and audit events" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* 6 Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Lifetime Spend</span>
                    <div className="text-sm font-black text-emerald-400 mt-1 font-mono">
                      {formatETB(customerDetail.stats.totalSpentMinor)}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Confirmed Tickets</span>
                    <div className="text-sm font-black text-white mt-1 font-mono">
                      {customerDetail.stats.confirmedTickets}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Active Holds</span>
                    <div className="text-sm font-black text-amber-400 mt-1 font-mono">
                      {customerDetail.stats.activeHolds}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Draw Victories</span>
                    <div className="text-sm font-black text-teal-400 mt-1 font-mono flex items-center gap-1">
                      <Trophy className="w-3.5 h-3.5 text-teal-400" />
                      {customerDetail.stats.wonDrawsCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Expired Holds</span>
                    <div className="text-sm font-black text-slate-400 mt-1 font-mono">
                      {customerDetail.stats.expiredReservations}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Joined OROJACKPOT</span>
                    <div className="text-xs font-bold text-slate-300 mt-1">
                      {new Date(customerDetail.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Tabs Bar */}
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <button
                    onClick={() => setDetailTab('overview')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${detailTab === 'overview'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    Player Overview
                  </button>
                  <button
                    onClick={() => setDetailTab('reservations')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${detailTab === 'reservations'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    Ticket History ({customerDetail.reservations.length})
                  </button>
                  <button
                    onClick={() => setDetailTab('audit')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${detailTab === 'audit'
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                      : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    Audit Trail ({customerDetail.auditLogs.length})
                  </button>
                  {customerDetail.wonDraws.length > 0 && (
                    <button
                      onClick={() => setDetailTab('wins')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${detailTab === 'wins'
                        ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                        : 'text-teal-400 hover:text-teal-200'
                        }`}
                    >
                      <Trophy className="w-3 h-3" />
                      Victories ({customerDetail.wonDraws.length})
                    </button>
                  )}
                </div>

                {/* Tab: Overview */}
                {detailTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                          Player Identification
                        </span>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Telegram User ID:</span>
                          <span className="font-mono text-white font-bold">{customerDetail.telegramUserId}</span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Username:</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {customerDetail.username ? `@${customerDetail.username}` : '—'}
                          </span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Full Name:</span>
                          <span className="text-white font-bold">
                            {customerDetail.firstName || customerDetail.lastName
                              ? `${customerDetail.firstName || ''} ${customerDetail.lastName || ''}`.trim()
                              : '—'}
                          </span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1">
                          <span className="text-slate-400">Account Role:</span>
                          <span className="text-slate-300 font-mono font-bold">{customerDetail.role}</span>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                          Security & Non-Repudiation Status
                        </span>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Anti-Fraud Status:</span>
                          <span
                            className={`font-bold ${customerDetail.isBlocked ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                          >
                            {customerDetail.isBlocked ? 'Restricted / Suspended' : 'Clear / Verified'}
                          </span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Registered At:</span>
                          <span className="text-slate-300">
                            {new Date(customerDetail.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1 border-b border-slate-800/80">
                          <span className="text-slate-400">Last System Update:</span>
                          <span className="text-slate-300">
                            {new Date(customerDetail.updatedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs flex items-center justify-between py-1">
                          <span className="text-slate-400">Direct Audit History:</span>
                          {onNavigateToAudit && (
                            <button
                              onClick={() => {
                                handleCloseCustomerDetail();
                                onNavigateToAudit(customerDetail.id, customerDetail.username || customerDetail.firstName || undefined);
                              }}
                              className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                            >
                              <span>Open in Audit Trail</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Reservations & Tickets */}
                {detailTab === 'reservations' && (
                  <div className="space-y-3">
                    {customerDetail.reservations.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-xs">
                        No reservations recorded for this player yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                              <th className="py-2.5 px-3">Reference</th>
                              <th className="py-2.5 px-3">Lottery Campaign</th>
                              <th className="py-2.5 px-3 text-center">Status</th>
                              <th className="py-2.5 px-3">Ticket Numbers</th>
                              <th className="py-2.5 px-3 text-right">Amount (ETB)</th>
                              <th className="py-2.5 px-3">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {customerDetail.reservations.map((r) => (
                              <tr key={r.id} className="hover:bg-slate-800/30">
                                <td className="py-2.5 px-3 font-mono text-emerald-400 font-bold text-xs">
                                  {r.publicReference}
                                </td>
                                <td className="py-2.5 px-3 font-bold text-white max-w-[160px] truncate">
                                  {r.lottery.title}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'CONFIRMED'
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                      : r.status === 'AWAITING_PAYMENT' || r.status === 'PENDING_REVIEW'
                                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                        : 'bg-slate-800 text-slate-400'
                                      }`}
                                  >
                                    {r.status}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                                    {r.items.slice(0, 6).map((item, idx) => (
                                      <span
                                        key={idx}
                                        className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-750 font-mono text-[10px] text-slate-300 font-semibold"
                                      >
                                        #{item.numberValue}
                                      </span>
                                    ))}
                                    {r.items.length > 6 && (
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        +{r.items.length - 6} more
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                                  {formatETB(r.totalAmountMinor)}
                                </td>
                                <td className="py-2.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">
                                  {new Date(r.createdAt).toLocaleDateString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Real User Audit History */}
                {detailTab === 'audit' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs text-slate-400">
                        Cryptographic tamper-evident activity logged for this user
                      </span>
                      {onNavigateToAudit && (
                        <button
                          onClick={() => {
                            handleCloseCustomerDetail();
                            onNavigateToAudit(customerDetail.id, customerDetail.username || customerDetail.firstName || undefined);
                          }}
                          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                          <span>Full Audit Trail View</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {customerDetail.auditLogs.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-xs">
                        No individual audit events recorded for this user yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {customerDetail.auditLogs.map((log) => (
                          <div
                            key={log.id}
                            className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-mono font-bold text-emerald-400 text-[11px] bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                                {log.action}
                              </span>
                              <div className="text-slate-300 text-[11px] font-mono">
                                {log.details ? (
                                  <span className="text-slate-400">
                                    {(log.details as any).reason ||
                                      (log.details as any).note ||
                                      (log.details as any).lotteryTitle ||
                                      `Target: ${log.entityType}`}
                                  </span>
                                ) : (
                                  `Target: ${log.entityType}`
                                )}
                              </div>
                            </div>
                            <div className="text-slate-500 text-[11px] shrink-0 font-mono">
                              {new Date(log.createdAt).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Wins */}
                {detailTab === 'wins' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {customerDetail.wonDraws.map((win) => (
                        <div
                          key={win.id}
                          className="p-4 rounded-2xl bg-gradient-to-br from-teal-950/40 to-slate-950 border border-teal-500/30 flex items-center gap-3.5"
                        >
                          <div className="w-10 h-10 rounded-2xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0">
                            <Trophy className="w-5 h-5 text-teal-400" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">{win.prizeLabel}</div>
                            <div className="text-[11px] text-teal-300 font-semibold">{win.lotteryTitle}</div>
                            <div className="text-[10px] text-slate-400 mt-1 font-mono">
                              Winning Number: <strong className="text-white">#{win.winningNumber}</strong> • {new Date(win.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Block / Unblock Confirmation Modal */}
      {blockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${blockTarget.isBlocked
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
                  }`}
              >
                {blockTarget.isBlocked ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-base font-black text-white">
                  {blockTarget.isBlocked ? 'Restore Player Access' : 'Block Player Account'}
                </h3>
                <p className="text-xs text-slate-400">
                  {blockTarget.isBlocked
                    ? 'Allow player to reserve lottery tickets again'
                    : 'Prevent player from reserving new tickets or participating in draws'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
              <div>
                <span className="text-slate-400">Player: </span>
                <strong className="text-white">
                  {blockTarget.firstName || blockTarget.username || `#${blockTarget.telegramUserId}`}
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Telegram ID: </span>
                <span className="font-mono text-emerald-400">{blockTarget.telegramUserId}</span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Reason for {blockTarget.isBlocked ? 'Unblocking' : 'Blocking'} (Logged to Audit Trail)
              </label>
              <textarea
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder={
                  blockTarget.isBlocked
                    ? 'e.g. Issue resolved after verification'
                    : 'e.g. Excessive hoarding of unpaid ticket reservations'
                }
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {blockError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {blockError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setBlockTarget(null)}
                disabled={isSubmittingBlock}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleToggleBlockConfirm()}
                disabled={isSubmittingBlock}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md flex items-center gap-1.5 ${blockTarget.isBlocked
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-rose-600 hover:bg-rose-500'
                  }`}
              >
                {isSubmittingBlock ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : blockTarget.isBlocked ? (
                  <ShieldCheck className="w-3.5 h-3.5" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                <span>{blockTarget.isBlocked ? 'Confirm Unblock' : 'Confirm Block'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
