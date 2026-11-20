import React, { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp,
  Ticket,
  Clock,
  AlertTriangle,
  Users,
  Layers,
  RefreshCw,
  ArrowRight,
  Coins,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AdminOverview } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

interface AdminOverviewViewProps {
  onNavigateTab: (tab: string) => void;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({ onNavigateTab }) => {
  const [metrics, setMetrics] = useState<AdminOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getAdminOverview();
      setMetrics(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const formatETB = (minor: string | undefined): string => {
    if (!minor) return '0.00 ETB';
    const num = Number(BigInt(minor)) / 100;
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Platform Operations & KPIs</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time aggregate data synchronized from PostgreSQL
          </p>
        </div>
        <button
          onClick={() => void fetchOverview()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {isLoading && !metrics ? (
        <CustomLoader
          fullScreen={false}
          message="Loading platform operations"
          subtitle="Aggregating GMV, tickets, and operational analytics"
        />
      ) : null}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void fetchOverview()}
            className="font-bold underline ml-2 text-rose-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <div className="fulus-card-nested p-5 rounded-2xl flex flex-col justify-between relative overflow-hidden group hover:border-[#00d26a]/40 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
              Total Confirmed Revenue
            </span>
            <div className="w-10 h-10 rounded-2xl bg-[#0c251b] border border-[#123c2a] text-[#00d26a] flex items-center justify-center">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight font-display">
            {formatETB(metrics?.totalRevenueMinor)}
          </div>
          <div className="mt-3 text-[11px] text-[#00d26a] flex items-center gap-1 font-medium">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Settled Bank & Telebirr transfers</span>
          </div>
        </div>

        {/* Tickets Sold */}
        <div className="fulus-card-nested p-5 rounded-2xl flex flex-col justify-between hover:border-[#00d26a]/40 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
              Tickets Sold
            </span>
            <div className="w-10 h-10 rounded-2xl bg-[#0c251b] border border-[#123c2a] text-[#00d26a] flex items-center justify-center">
              <Ticket className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight font-display">
            {(metrics?.totalTicketsSold || 0).toLocaleString()}
          </div>
          <div className="mt-3 text-[11px] text-[#94a3b8]">
            Across all active & completed campaigns
          </div>
        </div>

        {/* Pending Reviews - High Attention */}
        <div
          onClick={() => onNavigateTab('reviews')}
          className={`p-5 rounded-2xl border cursor-pointer transition-all ${
            (metrics?.pendingReviewsCount || 0) > 0
              ? 'bg-[#261a0c]/40 border-[#422b13] hover:border-[#f59e0b]'
              : 'fulus-card-nested hover:border-[#1a2230]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
              Pending Evidence Reviews
            </span>
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                (metrics?.pendingReviewsCount || 0) > 0
                  ? 'bg-[#261a0c] border border-[#422b13] text-[#f59e0b] animate-pulse'
                  : 'bg-[#151c27] border border-[#1a2230] text-[#94a3b8]'
              }`}
            >
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-black text-white tracking-tight font-display">
              {metrics?.pendingReviewsCount || 0}
            </div>
            {(metrics?.pendingReviewsCount || 0) > 0 && (
              <span className="text-xs font-bold text-[#f59e0b] bg-[#261a0c] border border-[#422b13] px-2 py-0.5 rounded-full">
                Action Required
              </span>
            )}
          </div>
          <div className="mt-3 text-[11px] text-[#f59e0b] flex items-center gap-1 font-bold">
            <span>Open Review Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Active Campaigns */}
        <div
          onClick={() => onNavigateTab('campaigns')}
          className="fulus-card-nested p-5 rounded-2xl hover:border-[#00d26a]/40 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
              Open Campaigns
            </span>
            <div className="w-10 h-10 rounded-2xl bg-[#0c251b] border border-[#123c2a] text-[#00d26a] flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight font-display">
            {metrics?.activeCampaignsCount || 0}
          </div>
          <div className="mt-3 text-[11px] text-[#94a3b8] flex items-center gap-1 font-bold">
            <span>Manage Lotteries</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Total Customers */}
        <div
          onClick={() => onNavigateTab('customers')}
          className="fulus-card-nested p-5 rounded-2xl hover:border-[#1a2230] cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
              Registered Customers
            </span>
            <div className="w-10 h-10 rounded-2xl bg-[#151c27] border border-[#1a2230] text-[#94a3b8] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight font-display">
            {(metrics?.totalCustomersCount || 0).toLocaleString()}
          </div>
          <div className="mt-3 text-[11px] text-[#94a3b8] flex items-center gap-1 font-bold">
            <span>View Customers</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Operational Highlights Banner */}
      <div className="p-6 rounded-3xl fulus-card border-[#123c2a] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-[10px] font-black text-[#00d26a] tracking-wider uppercase">
            Audit Trail & Fraud Prevention Active
          </span>
          <h3 className="text-base font-bold text-white font-display">
            Mandatory Bank Statement Verification
          </h3>
          <p className="text-xs text-[#94a3b8] max-w-xl">
            To prevent fraud from fabricated screenshots, operator reviews require explicit confirmation
            that payment evidence matches official CBE/Telebirr statements before approval is enabled.
          </p>
        </div>
        <button
          onClick={() => onNavigateTab('reviews')}
          className="fulus-btn-primary px-5 py-3 text-xs font-bold shrink-0"
        >
          Review Submissions
        </button>
      </div>
    </div>
  );
};
