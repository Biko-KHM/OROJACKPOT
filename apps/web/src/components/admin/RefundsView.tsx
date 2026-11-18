import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  CheckCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  Check,
  X,
  CreditCard,
  User,
} from 'lucide-react';
import { AdminRefundItem } from '../../types/index.js';
import { api } from '../../api/client.js';
import { CustomLoader } from '../CustomLoader.js';

export const RefundsView: React.FC = () => {
  const [refunds, setRefunds] = useState<AdminRefundItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Mark Paid Modal state
  const [selectedRefund, setSelectedRefund] = useState<AdminRefundItem | null>(null);
  const [paymentNote, setPaymentNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchRefunds = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRefunds(statusFilter === 'ALL' ? undefined : statusFilter);
      setRefunds(Array.isArray(data?.refunds) ? data.refunds : []);
      setTotal(data?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch refunds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRefunds();
  }, [statusFilter]);

  const handleOpenMarkPaid = (refund: AdminRefundItem) => {
    setSelectedRefund(refund);
    setPaymentNote(`Manually refunded via CBE / Telebirr`);
  };

  const handleConfirmMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRefund) return;

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.markRefundPaid(selectedRefund.id, paymentNote.trim());
      setSuccessMessage(`Refund for reservation ${selectedRefund.reservationReference} marked as PAID.`);
      setSelectedRefund(null);
      await fetchRefunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark refund as paid');
    } finally {
      setSubmitting(false);
    }
  };

  // Filter refunds by search term
  const filteredRefunds = refunds.filter((r) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.reservationReference.toLowerCase().includes(term) ||
      r.lotteryTitle.toLowerCase().includes(term) ||
      r.customer.telegramUserId.includes(term) ||
      (r.customer.username && r.customer.username.toLowerCase().includes(term))
    );
  });

  // Calculate summary metrics
  const pendingCount = refunds.filter((r) => r.status === 'PENDING').length;
  const pendingTotalMinor = refunds
    .filter((r) => r.status === 'PENDING')
    .reduce((sum, r) => sum + BigInt(r.amountMinor), 0n);

  const paidCount = refunds.filter((r) => r.status === 'PAID').length;
  const paidTotalMinor = refunds
    .filter((r) => r.status === 'PAID')
    .reduce((sum, r) => sum + BigInt(r.amountMinor), 0n);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-amber-400" />
              <span>Cancellation Refunds Queue</span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Confirmed ticket buyers whose lottery was cancelled. Mark records as PAID after manual CBE / Telebirr transfers.
          </p>
        </div>

        <button
          onClick={() => void fetchRefunds()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Pending Payouts</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-400">{pendingCount}</span>
            <span className="text-xs font-mono text-slate-400">
              ({(Number(pendingTotalMinor) / 100).toFixed(2)} ETB)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Awaiting manual bank / Telebirr transfer</p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Completed Refunds</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-400">{paidCount}</span>
            <span className="text-xs font-mono text-slate-400">
              ({(Number(paidTotalMinor) / 100).toFixed(2)} ETB)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Confirmed refunded outside system</p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Claims</span>
            <CreditCard className="w-4 h-4 text-teal-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{total}</span>
            <span className="text-xs text-slate-400">cancelled reservations</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">All-time cancellation claims</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {(['ALL', 'PENDING', 'PAID'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                statusFilter === status
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search ref, campaign, TG ID..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Refunds Table */}
      <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-lg">
        {loading ? (
          <CustomLoader
            fullScreen={false}
            message="Loading refund claims"
            subtitle="Tracking cancellation settlements and payment accounts"
          />
        ) : filteredRefunds.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            <RotateCcw className="w-8 h-8 mx-auto mb-2 text-slate-700" />
            <p className="font-bold text-slate-400">No refunds found</p>
            <p className="text-[11px] mt-0.5">Cancelled lottery ticket holders will appear here automatically.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Reservation Ref</th>
                  <th className="py-3.5 px-4">Campaign</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Amount</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Note / Handler</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredRefunds.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-white whitespace-nowrap">
                      {r.reservationReference}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-medium max-w-xs truncate">
                      {r.lotteryTitle}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono text-slate-200">{r.customer.telegramUserId}</span>
                        {r.customer.username && (
                          <span className="text-slate-400 text-[11px]">(@{r.customer.username})</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-400 whitespace-nowrap">
                      {(Number(r.amountMinor) / 100).toFixed(2)} ETB
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {r.status === 'PAID' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <Check className="w-3 h-3" /> PAID
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <Clock className="w-3 h-3" /> PENDING
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      {r.note && <div className="text-slate-300 text-[11px] truncate">{r.note}</div>}
                      {r.handler && (
                        <div className="text-slate-500 text-[10px]">Handled by {r.handler.email}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {r.status === 'PENDING' ? (
                        <button
                          type="button"
                          onClick={() => handleOpenMarkPaid(r)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-sm cursor-pointer"
                        >
                          Mark Paid
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-mono">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mark Paid Modal */}
      {selectedRefund && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-black text-white">Confirm Refund Payout</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRefund(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Reservation:</span>
                <span className="font-mono font-bold text-white">{selectedRefund.reservationReference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Campaign:</span>
                <span className="text-slate-200 font-medium truncate max-w-[200px]">
                  {selectedRefund.lotteryTitle}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Customer TG ID:</span>
                <span className="font-mono text-slate-200">{selectedRefund.customer.telegramUserId}</span>
              </div>
              <div className="flex justify-between items-baseline pt-1 border-t border-slate-800">
                <span className="text-slate-400 font-bold">Refund Amount:</span>
                <span className="font-mono text-base font-black text-emerald-400">
                  {(Number(selectedRefund.amountMinor) / 100).toFixed(2)} ETB
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmMarkPaid} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Transfer Reference / Note (Optional)
                </label>
                <textarea
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  placeholder="e.g. Telebirr reference #123456789 or CBE account transfer"
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                Ensure you have completed the actual bank or Telebirr transfer before confirming. This operation is recorded in the audit trail.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRefund(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Recording...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm Payout</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
