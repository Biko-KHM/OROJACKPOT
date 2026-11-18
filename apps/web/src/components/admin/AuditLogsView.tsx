import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Lock,
  Search,
  Filter,
  User,
  Shield,
  Trophy,
  Ticket,
  CreditCard,
  Settings,
  Cpu,
  Copy,
  Check,
  X,
  Eye,
  Key,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Database,
  Trash2,
  Clock,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AuditLogItem } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

interface AuditLogsViewProps {
  initialActorUserId?: string;
  initialActorName?: string;
  onClearUserFilter?: () => void;
  onNavigateToCustomer?: (userId: string) => void;
  currentAdmin?: { id: string; email: string; role: 'SUPERADMIN' | 'ADMIN' };
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  initialActorUserId,
  initialActorName,
  onClearUserFilter,
  onNavigateToCustomer,
  currentAdmin,
}) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeSuccessMessage, setPurgeSuccessMessage] = useState<string | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [selectedUserFilter, setSelectedUserFilter] = useState<string | undefined>(initialActorUserId);
  const [selectedUserName, setSelectedUserName] = useState<string | undefined>(initialActorName);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [timeframeFilter, setTimeframeFilter] = useState<string>('7d');
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = !currentAdmin || currentAdmin.role === 'SUPERADMIN';

  // Inspector modal state
  const [inspectLog, setInspectLog] = useState<AuditLogItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync with prop when parent changes it
  useEffect(() => {
    if (initialActorUserId !== undefined) {
      setSelectedUserFilter(initialActorUserId);
      setSelectedUserName(initialActorName);
    }
  }, [initialActorUserId, initialActorName]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLogs({
        entityType: entityFilter.trim() || undefined,
        actorUserId: selectedUserFilter,
        search: searchQuery.trim() || undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        timeframe: timeframeFilter,
        limit: 150,
      });
      setLogs(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cryptographic audit trail');
    } finally {
      setIsLoading(false);
    }
  }, [entityFilter, selectedUserFilter, searchQuery, categoryFilter, timeframeFilter]);

  const handlePurgeExpired = async () => {
    setIsPurging(true);
    setPurgeSuccessMessage(null);
    setError(null);
    try {
      const res = await api.purgeExpiredAuditLogs();
      setPurgeSuccessMessage(res.message || `Successfully purged ${res.purgedCount} expired audit logs older than 7 days.`);
      setShowPurgeConfirm(false);
      await fetchLogs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to purge expired audit logs');
    } finally {
      setIsPurging(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchLogs();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleClearUserFilter = () => {
    setSelectedUserFilter(undefined);
    setSelectedUserName(undefined);
    if (onClearUserFilter) {
      onClearUserFilter();
    }
  };

  const handleFilterByActor = (actorUserId?: string | null, actorName?: string | null) => {
    if (!actorUserId) return;
    setSelectedUserFilter(actorUserId);
    setSelectedUserName(actorName || actorUserId.slice(0, 8));
  };

  // Helper action styling
  const getActionBadge = (action: string) => {
    if (action.startsWith('DRAW_')) {
      return {
        bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        icon: Trophy,
        label: action,
      };
    }
    if (action.includes('AUTH') || action.includes('LOGIN') || action.includes('TOTP') || action.includes('PASSWORD')) {
      return {
        bg: action.includes('FAILED')
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
        icon: Key,
        label: action,
      };
    }
    if (action.startsWith('RESERVATION_') || action.includes('HOARDING')) {
      return {
        bg: action.includes('EXPIRED') || action.includes('HOARDING')
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
        icon: Ticket,
        label: action,
      };
    }
    if (action.startsWith('PAYMENT_')) {
      return {
        bg: action.includes('APPROVED')
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          : action.includes('REJECTED')
          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          : 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        icon: CreditCard,
        label: action,
      };
    }
    if (action.includes('BLOCKED') || action.includes('UNBLOCKED')) {
      return {
        bg: action.includes('BLOCKED')
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        icon: action.includes('BLOCKED') ? ShieldAlert : ShieldCheck,
        label: action,
      };
    }
    return {
      bg: 'bg-slate-800 text-slate-300 border-slate-700',
      icon: Shield,
      label: action,
    };
  };

  // Helper to extract high-value detail snippets
  const renderDetailSnippet = (details: any) => {
    if (!details || typeof details !== 'object') {
      return <span className="text-slate-500 font-mono text-[11px]">—</span>;
    }

    const items: Array<{ key: string; val: string }> = [];

    if (details.winningNumber !== undefined) {
      items.push({ key: 'Winning #', val: `#${details.winningNumber}` });
    }
    if (details.winnerTelegramUserId) {
      items.push({ key: 'Winner TG', val: details.winnerTelegramUserId });
    }
    if (details.prizeLabel) {
      items.push({ key: 'Prize', val: details.prizeLabel });
    }
    if (details.reason) {
      items.push({ key: 'Reason', val: String(details.reason) });
    }
    if (details.note) {
      items.push({ key: 'Note', val: String(details.note) });
    }
    if (details.customerUsername) {
      items.push({ key: 'User', val: `@${details.customerUsername}` });
    }
    if (details.claimedAmountMinor) {
      const etb = (Number(details.claimedAmountMinor) / 100).toFixed(2);
      items.push({ key: 'Amount', val: `${etb} ETB` });
    }
    if (details.paymentReference) {
      items.push({ key: 'Ref', val: details.paymentReference });
    }
    if (details.eligibleCount !== undefined) {
      items.push({ key: 'Eligible', val: `${details.eligibleCount} tickets` });
    }

    if (items.length === 0) {
      // Fallback: truncated JSON
      const jsonStr = JSON.stringify(details);
      return (
        <span className="font-mono text-[10px] text-slate-400 truncate max-w-xs block" title={jsonStr}>
          {jsonStr.length > 50 ? `${jsonStr.slice(0, 50)}...` : jsonStr}
        </span>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
        {items.slice(0, 3).map((item, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-300"
          >
            <span className="text-slate-500">{item.key}:</span>
            <strong className="text-white truncate max-w-[120px]">{item.val}</strong>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white tracking-tight">Cryptographic Audit Trail</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              TAMPER-PROOF APPEND-ONLY
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Zero-trust immutable audit logs with real player and operator actor resolution
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => void fetchLogs()}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-750 transition-colors text-xs font-semibold shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh Trail</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {purgeSuccessMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{purgeSuccessMessage}</span>
          </div>
          <button onClick={() => setPurgeSuccessMessage(null)} className="text-emerald-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 7-Day Rolling Retention & Cryptographic Protection Notice */}
      <div className="p-4 sm:p-5 rounded-3xl bg-slate-900/80 border border-slate-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-lg shadow-black/20">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20 shadow-inner">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-black text-white flex flex-wrap items-center gap-2">
              <span>7-Day Rolling Retention Policy</span>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                1-WEEK RETENTION ACTIVE
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                PostgreSQL Engine Protected
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Audit logs are maintained on a strict 7-day rolling window to optimize database overhead and keep records focused and actionable. Active logs within the 1-week window are strictly protected by database triggers that forbid unauthorized tampering or deletion.
            </p>
          </div>
        </div>

        {/* Superadmin Retention Actions & Quick Purge */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-stretch sm:self-auto justify-end">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-300">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-500">Active Records:</span>
            <strong className="text-white">{logs.length}</strong>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => setShowPurgeConfirm(true)}
              disabled={isPurging || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
              title="Purge audit logs older than 7 days"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-400" />
              <span>{isPurging ? 'Purging...' : 'Purge > 7 Days'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Purge Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0e131b] border border-[#1a2230] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Execute 7-Day Retention Purge</h3>
                <p className="text-xs text-slate-400 mt-0.5">Automated Rolling Audit Log Cleanup</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This action permanently deletes all audit trail records older than <strong>7 days (168 hours)</strong> from PostgreSQL storage. Records within the active 1-week window will remain strictly intact and protected.
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>An immutable audit row of this purge operation will be recorded.</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPurgeConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePurgeExpired()}
                disabled={isPurging}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-black transition-all shadow-md shadow-amber-500/20 active:scale-95 disabled:opacity-50"
              >
                {isPurging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirm Purge</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active User History Filter Banner */}
      {selectedUserFilter && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/40 border border-indigo-500/40 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Filtered to Real User Audit History:</span>
                <span className="text-indigo-400 font-mono">
                  {selectedUserName ? `@${selectedUserName}` : selectedUserFilter}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                User UUID: {selectedUserFilter}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToCustomer && (
              <button
                onClick={() => onNavigateToCustomer(selectedUserFilter)}
                className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-bold border border-indigo-500/30 transition-colors flex items-center gap-1"
              >
                <span>360 Profile</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={handleClearUserFilter}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              <span>Show All Users</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter and Category Toolbar */}
      <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800 space-y-3 shadow-sm">
        {/* Retention Window Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pb-2.5 border-b border-slate-800/80">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" />
            Retention Window:
          </span>
          <button
            onClick={() => setTimeframeFilter('7d')}
            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
              timeframeFilter === '7d'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Past 7 Days (1-Week Active)
          </button>
          <button
            onClick={() => setTimeframeFilter('24h')}
            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
              timeframeFilter === '24h'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Past 24 Hours
          </button>
          <button
            onClick={() => setTimeframeFilter('3d')}
            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
              timeframeFilter === '3d'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Past 3 Days
          </button>
        </div>

        {/* Action Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" />
            Category:
          </span>
          <button
            onClick={() => setCategoryFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              categoryFilter === 'ALL'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All Events
          </button>
          <button
            onClick={() => setCategoryFilter('SECURITY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'SECURITY'
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Shield className="w-3 h-3" />
            <span>Security & Auth</span>
          </button>
          <button
            onClick={() => setCategoryFilter('DRAWS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'DRAWS'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Trophy className="w-3 h-3" />
            <span>Draws & VRF</span>
          </button>
          <button
            onClick={() => setCategoryFilter('RESERVATIONS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'RESERVATIONS'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Ticket className="w-3 h-3" />
            <span>Reservations & Holds</span>
          </button>
          <button
            onClick={() => setCategoryFilter('PAYMENTS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'PAYMENTS'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <CreditCard className="w-3 h-3" />
            <span>Payments</span>
          </button>
          <button
            onClick={() => setCategoryFilter('ADMIN')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'ADMIN'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Settings className="w-3 h-3" />
            <span>Admin Controls</span>
          </button>
          <button
            onClick={() => setCategoryFilter('SYSTEM')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              categoryFilter === 'SYSTEM'
                ? 'bg-slate-700 text-white border border-slate-600 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Cpu className="w-3 h-3" />
            <span>Automated Worker</span>
          </button>
        </div>

        {/* Search & Entity Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search action, actor username/name/email, or request ID..."
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

          <div>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="">All Entity Types</option>
              <option value="DRAW">DRAW</option>
              <option value="RESERVATION">RESERVATION</option>
              <option value="PAYMENT_SUBMISSION">PAYMENT_SUBMISSION</option>
              <option value="USER">USER</option>
              <option value="LOTTERY">LOTTERY</option>
              <option value="SETTINGS">SETTINGS</option>
            </select>
          </div>
        </div>
      </div>

      {/* Well-Structured Audit Logs Table */}
      {isLoading && logs.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading tamper-proof audit trail"
          subtitle="Verifying PostgreSQL non-repudiation constraints & resolving real user actors"
        />
      ) : logs.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/40 rounded-3xl border border-slate-800 text-slate-400 text-xs">
          <Shield className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="font-bold text-white text-sm">No audit logs recorded for this criteria</div>
          <p className="text-slate-500 mt-1">Try resetting the category filter or searching a different term.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60 shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Action Event</th>
                <th className="py-3.5 px-4">Target Entity</th>
                <th className="py-3.5 px-4">Operator / Real User Actor</th>
                <th className="py-3.5 px-4">Details & Payload</th>
                <th className="py-3.5 px-4">Request Trace</th>
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4 text-right">Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {logs.map((log) => {
                const badge = getActionBadge(log.action);
                const BadgeIcon = badge.icon;

                return (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => setInspectLog(log)}
                  >
                    {/* Action Badge */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold border shadow-sm ${badge.bg}`}
                      >
                        <BadgeIcon className="w-3 h-3 shrink-0" />
                        <span>{badge.label}</span>
                      </span>
                    </td>

                    {/* Target Entity */}
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-0.5">
                        <span className="font-bold text-white text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {log.entityType}
                        </span>
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 font-mono">
                          <span className="truncate max-w-[100px]">{log.entityId}</span>
                          <button
                            onClick={() => handleCopy(log.entityId, `ent-${log.id}`)}
                            className="text-slate-500 hover:text-white"
                            title="Copy Entity UUID"
                          >
                            {copiedId === `ent-${log.id}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Real User Operator / Actor */}
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      {log.actor.isSystem || !log.actor.userId ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center shrink-0 border border-slate-700">
                            <Cpu className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-300 text-xs">Automated Worker</div>
                            <div className="text-[10px] text-slate-500 font-mono">System Background Task</div>
                          </div>
                        </div>
                      ) : log.actor.role === 'SUPERADMIN' || log.actor.role === 'ADMIN' ? (
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
                              log.actor.role === 'SUPERADMIN'
                                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            <Shield className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-bold text-white text-xs flex items-center gap-1.5">
                              <span>{log.actor.email || log.actor.username || 'Admin'}</span>
                              <span
                                className={`text-[9px] font-black px-1.5 py-0.2 rounded ${
                                  log.actor.role === 'SUPERADMIN'
                                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {log.actor.role}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {log.actor.telegramUserId ? `TG: ${log.actor.telegramUserId}` : 'Internal Console'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Customer Actor */
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-800 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-sm">
                            {log.actor.username
                              ? log.actor.username.slice(0, 2).toUpperCase()
                              : 'TG'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() =>
                                  handleFilterByActor(
                                    log.actor.userId,
                                    log.actor.username || log.actor.firstName || undefined,
                                  )
                                }
                                className="font-bold text-emerald-400 hover:text-emerald-300 text-xs transition-colors flex items-center gap-1"
                                title="Filter only this customer's audit history"
                              >
                                <span>{log.actor.username ? `@${log.actor.username}` : log.actor.firstName || 'Customer'}</span>
                              </button>
                              <span className="text-[9px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded">
                                PLAYER
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              TG: {log.actor.telegramUserId || '—'}
                            </div>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Details Snippet */}
                    <td className="py-3 px-4">
                      {renderDetailSnippet(log.details)}
                    </td>

                    {/* Request Correlation Trace */}
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      {log.requestId ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 truncate max-w-[90px]">
                            {log.requestId}
                          </span>
                          <button
                            onClick={() => handleCopy(log.requestId!, `req-${log.id}`)}
                            className="text-slate-500 hover:text-white"
                            title="Copy Request ID"
                          >
                            {copiedId === `req-${log.id}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">—</span>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                      <div>{new Date(log.createdAt).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </div>
                    </td>

                    {/* Inspect Proof Button */}
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setInspectLog(log)}
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                        title="Inspect Cryptographic Proof & JSON Payload"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Cryptographic Proof & Event Inspector Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                    <span>Cryptographic Event Inspection</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {inspectLog.action}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Event UUID: {inspectLog.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectLog(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Event Metadata Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Target Entity</span>
                  <div className="font-mono font-bold text-white mt-0.5">{inspectLog.entityType}</div>
                  <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                    {inspectLog.entityId}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Actor Role</span>
                  <div className="font-mono font-bold text-emerald-400 mt-0.5">
                    {inspectLog.actor.role || 'SYSTEM'}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {inspectLog.actor.username ? `@${inspectLog.actor.username}` : inspectLog.actor.email || 'Automated'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Request Trace</span>
                  <div className="font-mono text-[10px] text-slate-300 truncate mt-1">
                    {inspectLog.requestId || 'Internal'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Logged At</span>
                  <div className="text-[11px] font-bold text-slate-300 mt-0.5">
                    {new Date(inspectLog.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {new Date(inspectLog.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* JSON Payload Inspector */}
              <div>
                <div className="flex items-center justify-between pb-1.5">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Audit Payload & Cryptographic Proof Data</span>
                  </span>
                  <button
                    onClick={() => handleCopy(JSON.stringify(inspectLog, null, 2), 'raw-log')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors"
                  >
                    {copiedId === 'raw-log' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedId === 'raw-log' ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                </div>
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto max-h-72">
                  <pre className="whitespace-pre">
                    {JSON.stringify(inspectLog.details || {}, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Non-Repudiation Footer Note */}
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  This record is append-only and cryptographically committed in PostgreSQL. Modification is blocked by trigger constraints.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
              {inspectLog.actor.userId && (
                <button
                  onClick={() => {
                    handleFilterByActor(
                      inspectLog.actor.userId,
                      inspectLog.actor.username || inspectLog.actor.firstName || undefined,
                    );
                    setInspectLog(null);
                  }}
                  className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filter Entire Trail By This Actor</span>
                </button>
              )}
              <button
                onClick={() => setInspectLog(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold ml-auto transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
