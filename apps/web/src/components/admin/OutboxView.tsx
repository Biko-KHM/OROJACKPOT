import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, RotateCw, Loader2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { FailedOutboxItem } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

export const OutboxView: React.FC = () => {
  const [events, setEvents] = useState<FailedOutboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchFailed = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getFailedOutbox(50, 0);
      const list = Array.isArray(data?.events)
        ? data.events
        : Array.isArray((data as any)?.items)
        ? (data as any).items
        : [];
      setEvents(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch failed outbox events');
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFailed();
  }, [fetchFailed]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    setActionSuccess(null);
    try {
      await api.retryFailedOutbox(id);
      setActionSuccess('Outbox event reset to PENDING and queued for immediate delivery.');
      await fetchFailed();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const safeEvents = Array.isArray(events) ? events : [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Outbox & Telegram Queue Monitor</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor undelivered Telegram notifications and channel updates with dead-letter retry
          </p>
        </div>
        <button
          onClick={() => void fetchFailed()}
          disabled={isLoading}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Outbox Status Card */}
      <div className="p-4 rounded-3xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-sm font-extrabold text-white">Outbox Reliability Engine</div>
          <div className="text-xs text-slate-400 mt-0.5">
            PostgreSQL SKIP LOCKED worker retries events up to 8 times with exponential backoff.
          </div>
        </div>
        <div className="px-3 py-1 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold">
          {safeEvents.length} Dead-Letter Events
        </div>
      </div>

      {/* Events Table / Loading */}
      {isLoading && safeEvents.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading outbox queue"
          subtitle="Checking undelivered Telegram notifications and dead-letter jobs"
        />
      ) : safeEvents.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-3xl border border-slate-800 text-slate-400 text-xs space-y-1">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-white font-bold">All outbox events successfully dispatched!</p>
          <p className="text-slate-500">Zero failed events in queue.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Event Type</th>
                <th className="py-3.5 px-4">Attempts</th>
                <th className="py-3.5 px-4">Last Error Reason</th>
                <th className="py-3.5 px-4">Created Time</th>
                <th className="py-3.5 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {safeEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-white text-xs">
                    {ev.eventType}
                  </td>
                  <td className="py-3 px-4 font-mono text-amber-400 font-bold">
                    {ev.attempts} / 8
                  </td>
                  <td className="py-3 px-4 text-rose-300 max-w-md truncate font-mono text-[11px]">
                    {ev.lastError || 'Unknown delivery failure'}
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-[11px]">
                    {new Date(ev.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => void handleRetry(ev.id)}
                      disabled={retryingId === ev.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-colors disabled:opacity-50"
                    >
                      {retryingId === ev.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="w-3.5 h-3.5" />
                      )}
                      <span>Retry Dispatch</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
