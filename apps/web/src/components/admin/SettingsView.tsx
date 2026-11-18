import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  UserPlus,
  Shield,
  CheckCircle,
  AlertTriangle,
  Lock,
  Copy,
  Check,
  Loader2,
  X,
  Crown,
  ShieldCheck,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  UserX,
  Trash2,
  Unlock,
  Eye,
  EyeOff,
  Power,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { AdminUser, AdminTeamMember, PlatformSettings, TestChannelResult } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';

interface SettingsViewProps {
  currentAdmin: AdminUser;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentAdmin }) => {
  const isSuperadmin = currentAdmin.role === 'SUPERADMIN';

  const [settings, setSettings] = useState<PlatformSettings>({
    dualApprovalRequired: false,
    dualApprovalThresholdMinor: '1000000',
    reviewEscalationDelayMinutes: 120,
    maintenanceMode: false,
    customerSupportTelegram: '@EthiopianLotterySupport',
    telegramChannelId: '',
  });

  const [isTestingChannel, setIsTestingChannel] = useState(false);
  const [channelTestResult, setChannelTestResult] = useState<TestChannelResult | null>(null);
  const [users, setUsers] = useState<AdminTeamMember[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State for Admin Team Table
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'SUPERADMIN' | 'ADMIN' | 'LOCKED' | 'DEACTIVATED'>('ALL');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isProcessingAction, setIsProcessingAction] = useState<string | null>(null);

  // Reset Password Modal State
  const [selectedUserForResetPassword, setSelectedUserForResetPassword] = useState<AdminTeamMember | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [showResetPasswordEye, setShowResetPasswordEye] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Reset pagination when searching or changing role filters
  useEffect(() => {
    setCurrentPage(1);
  }, [userSearch, roleFilter]);

  // Create User Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTelegramId, setNewTelegramId] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCreatePasswordEye, setShowCreatePasswordEye] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'SUPERADMIN'>('ADMIN');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [settingsData, usersData] = await Promise.all([
        api.getAdminSettings(),
        api.getAdminUsers(),
      ]);
      setSettings(settingsData);
      setUsers(usersData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings and users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperadmin) return;

    setIsSavingSettings(true);
    setActionSuccess(null);
    try {
      const updated = await api.updateAdminSettings(settings);
      setSettings(updated);
      setActionSuccess('System settings updated and audited successfully.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestChannel = async () => {
    const channelToTest = settings.telegramChannelId?.trim();
    if (!channelToTest) {
      alert('Please enter a Telegram Channel Username (e.g. @MyChannel) or ID (-100...) before testing.');
      return;
    }

    setIsTestingChannel(true);
    setChannelTestResult(null);
    try {
      const res = await api.testTelegramChannel(channelToTest);
      setChannelTestResult(res);
    } catch (err: unknown) {
      setChannelTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to test Telegram channel connection.',
      });
    } finally {
      setIsTestingChannel(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTelegramId || !newEmail || !newPassword) return;

    setIsCreatingUser(true);
    try {
      const res = await api.createAdminUser({
        telegramUserId: newTelegramId.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
        firstName: newFirstName.trim() || undefined,
        lastName: newLastName.trim() || undefined,
      });

      setIsCreateModalOpen(false);
      setActionSuccess(
        `${newRole === 'SUPERADMIN' ? 'Superadmin' : 'Staff'} account created for ${res.email} (Telegram ID: ${newTelegramId.trim()}). The operator will be required to change their temporary password upon their first login.`
      );
      setNewTelegramId('');
      setNewEmail('');
      setNewPassword('');
      setNewFirstName('');
      setNewLastName('');
      setNewRole('ADMIN');
      setCurrentPage(1);
      setUserSearch('');
      setRoleFilter('ALL');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeactivate = async (u: AdminTeamMember) => {
    const name = u.email || u.username || u.id;
    if (!window.confirm(`Are you sure you want to revoke administrative access from ${name}? Their console access will be deactivated and they will be treated as a normal customer until resumed.`)) {
      return;
    }
    setIsProcessingAction(u.id);
    try {
      const res = await api.deactivateAdminUser(u.id);
      setActionSuccess(res.message);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate admin account');
    } finally {
      setIsProcessingAction(null);
    }
  };

  const handleResume = async (u: AdminTeamMember) => {
    setIsProcessingAction(u.id);
    try {
      const res = await api.resumeAdminUser(u.id);
      setActionSuccess(res.message);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resume admin account');
    } finally {
      setIsProcessingAction(null);
    }
  };

  const handleDelete = async (u: AdminTeamMember) => {
    const name = u.email || u.username || u.id;
    if (!window.confirm(`Are you sure you want to permanently delete ${name}? This will completely erase this administrator account from the database. This action cannot be undone.`)) {
      return;
    }
    setIsProcessingAction(u.id);
    try {
      const res = await api.deleteAdminUser(u.id);
      setActionSuccess(res.message);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete admin account');
    } finally {
      setIsProcessingAction(null);
    }
  };

  const handleUnlock = async (u: AdminTeamMember) => {
    setIsProcessingAction(u.id);
    try {
      const res = await api.unlockAdminUser(u.id);
      setActionSuccess(res.message);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to unlock account');
    } finally {
      setIsProcessingAction(null);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForResetPassword || !resetPasswordValue) return;
    setIsResettingPassword(true);
    try {
      const res = await api.resetAdminUserPassword(selectedUserForResetPassword.id, resetPasswordValue);
      setActionSuccess(res.message);
      setSelectedUserForResetPassword(null);
      setResetPasswordValue('');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const safeUsers = Array.isArray(users) ? users : [];

  const filteredUsers = safeUsers.filter((u) => {
    const isLocked = Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date() && !u.isDeactivated);
    if (roleFilter === 'DEACTIVATED' && !u.isDeactivated) return false;
    if (roleFilter === 'SUPERADMIN' && (u.isDeactivated || u.role !== 'SUPERADMIN')) return false;
    if (roleFilter === 'ADMIN' && (u.isDeactivated || u.role !== 'ADMIN')) return false;
    if (roleFilter === 'LOCKED' && !isLocked) return false;

    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
    const email = (u.email || '').toLowerCase();
    const username = (u.username || '').toLowerCase();
    const tgId = (u.telegramUserId || '').toLowerCase();
    return fullName.includes(q) || email.includes(q) || username.includes(q) || tgId.includes(q);
  });

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Platform Settings & Security</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure dual approval thresholds, review escalation, and administrative team credentials
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {!isSuperadmin && (
            <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Role: ADMIN (Read-Only Settings)</span>
            </div>
          )}
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && users.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading platform settings & security"
          subtitle="Fetching dual-approval rules, escalation timeouts, and admin credentials"
        />
      ) : null}

      {/* Settings Form */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex items-center gap-2.5 text-base font-extrabold text-white">
          <Settings className="w-5 h-5 text-emerald-400" />
          <span>Operational Parameters</span>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Dual Approval Switch (FR-22) */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Dual Approval Requirement</span>
                <input
                  type="checkbox"
                  disabled={!isSuperadmin}
                  checked={settings.dualApprovalRequired}
                  onChange={(e) =>
                    setSettings({ ...settings, dualApprovalRequired: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                When enabled, purchases above the threshold require approval by two distinct admins before confirmation.
              </p>
            </div>

            {/* Dual Approval Threshold */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
              <label className="block text-xs font-bold text-white">
                Dual Approval Threshold (ETB)
              </label>
              <input
                type="number"
                disabled={!isSuperadmin || !settings.dualApprovalRequired}
                value={Number(BigInt(settings.dualApprovalThresholdMinor || '1000000')) / 100}
                onChange={(e) => {
                  const minor = Math.round(parseFloat(e.target.value || '0') * 100);
                  setSettings({ ...settings, dualApprovalThresholdMinor: minor.toString() });
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-500">
                Purchases exceeding this amount require second operator sign-off.
              </p>
            </div>

            {/* Review Escalation Delay */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
              <label className="block text-xs font-bold text-white">
                Review Escalation Delay (Minutes)
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                min={15}
                max={1440}
                value={settings.reviewEscalationDelayMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    reviewEscalationDelayMinutes: parseInt(e.target.value, 10) || 120,
                  })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-500">
                Pending reviews older than this delay will trigger urgent Telegram alerts to admins.
              </p>
            </div>

            {/* Customer Support Handle */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
              <label className="block text-xs font-bold text-white">
                Customer Support Telegram Handle
              </label>
              <input
                type="text"
                disabled={!isSuperadmin}
                value={settings.customerSupportTelegram}
                onChange={(e) =>
                  setSettings({ ...settings, customerSupportTelegram: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-500">
                Displayed to customers on payment receipts and help screens.
              </p>
            </div>

            {/* Telegram Channel & Auto-Posting Wiring (Superadmin) */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 md:col-span-2 shadow-inner">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-black text-white flex items-center gap-2">
                    📢 Telegram Channel & Auto-Posting
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                    Live Sync
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Channel where lottery announcements, tickets progress & draws broadcast
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-xs font-bold text-white">
                    Telegram Channel ID or Public Username
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      disabled={!isSuperadmin}
                      placeholder="@hiree_lottery or -1001234567890"
                      value={settings.telegramChannelId || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, telegramChannelId: e.target.value })
                      }
                      className="flex-1 min-w-0 w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={handleTestChannel}
                      disabled={isTestingChannel || !settings.telegramChannelId?.trim()}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#0c251b] hover:bg-[#123c2a] border border-[#123c2a] text-emerald-400 font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-40 whitespace-nowrap active:scale-95 shadow-sm shrink-0"
                      title="Verify bot is administrator with post messages permission"
                    >
                      {isTestingChannel ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      <span>Check Wiring</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Enter your channel handle with leading <b>@</b> (e.g. <code>@ethio_lottery</code>) or numeric ID (e.g. <code>-1001234567890</code>).
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5 text-[10.5px] text-slate-400">
                  <span className="font-bold text-slate-200 block text-[11px]">⚡ How to Wire It:</span>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-400">
                    <li>Open Telegram channel settings.</li>
                    <li>Add bot as an <b>Administrator</b>.</li>
                    <li>Enable <b>Post Messages</b> permission.</li>
                    <li>Enter handle above & click <b>Check Wiring</b>.</li>
                  </ol>
                </div>
              </div>

              {/* Real-time Wiring Test Feedback */}
              {channelTestResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 transition-all ${
                    channelTestResult.ok
                      ? 'bg-[#0c251b]/80 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-900/60 text-rose-300'
                  }`}
                >
                  {channelTestResult.ok ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-extrabold text-sm text-white">
                        {channelTestResult.ok ? 'Wiring Verified & Active' : 'Channel Wiring Notice'}
                      </span>
                      {channelTestResult.channelTitle && (
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40 border border-white/10 text-slate-300 font-semibold">
                          {channelTestResult.channelTitle} ({channelTestResult.channelId || channelTestResult.channelUsername})
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed">
                      {channelTestResult.ok
                        ? channelTestResult.message || `Bot @${channelTestResult.botUsername} is an administrator with posting permissions.`
                        : channelTestResult.error}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isSuperadmin && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isSavingSettings && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Platform Settings</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Admin Users Section */}
      <div className="p-6 rounded-3xl bg-[#0e131b] border border-[#1a2230] space-y-5 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shadow-md shadow-[#00d26a]/15 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-extrabold text-white tracking-tight">Administrative Team & Operators</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#0c251b] text-[#00d26a] border border-[#123c2a]">
                  {safeUsers.length} Operators
                </span>
              </div>
              <p className="text-xs text-[#94a3b8] mt-0.5">
                Manage administrative credentials, Telegram ID identity bindings, and role assignments
              </p>
            </div>
          </div>

          {isSuperadmin && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-black font-extrabold text-xs shadow-lg shadow-[#00d26a]/25 transition-all self-start sm:self-auto shrink-0 group"
            >
              <UserPlus className="w-4 h-4 text-black group-hover:scale-110 transition-transform" />
              <span>Add Admin / Operator</span>
            </button>
          )}
        </div>

        {/* Search & Role Filter Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#131923] p-2.5 rounded-2xl border border-[#1a2230]">
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none]">
            <button
              type="button"
              onClick={() => setRoleFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                roleFilter === 'ALL'
                  ? 'bg-[#00d26a] text-black shadow-md shadow-[#00d26a]/20'
                  : 'text-[#94a3b8] hover:text-white hover:bg-[#1a2230]'
              }`}
            >
              All ({safeUsers.length})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('SUPERADMIN')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                roleFilter === 'SUPERADMIN'
                  ? 'bg-[#f59e0b] text-black shadow-md shadow-[#f59e0b]/20'
                  : 'text-[#94a3b8] hover:text-white hover:bg-[#1a2230]'
              }`}
            >
              Superadmins ({safeUsers.filter((u) => u.role === 'SUPERADMIN').length})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('ADMIN')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                roleFilter === 'ADMIN'
                  ? 'bg-[#00d26a] text-black shadow-md shadow-[#00d26a]/20'
                  : 'text-[#94a3b8] hover:text-white hover:bg-[#1a2230]'
              }`}
            >
              Admins ({safeUsers.filter((u) => !u.isDeactivated && u.role === 'ADMIN').length})
            </button>
            {safeUsers.some((u) => u.isDeactivated) && (
              <button
                type="button"
                onClick={() => setRoleFilter('DEACTIVATED')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                  roleFilter === 'DEACTIVATED'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-amber-400 hover:bg-amber-500/10'
                }`}
              >
                Deactivated ({safeUsers.filter((u) => u.isDeactivated).length})
              </button>
            )}
            {safeUsers.some((u) => u.lockedUntil && new Date(u.lockedUntil) > new Date() && !u.isDeactivated) && (
              <button
                type="button"
                onClick={() => setRoleFilter('LOCKED')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                  roleFilter === 'LOCKED'
                    ? 'bg-rose-500 text-white'
                    : 'text-rose-400 hover:bg-rose-500/10'
                }`}
              >
                Locked Out
              </button>
            )}
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, email, role..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#090d14] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] transition-all"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto rounded-2xl border border-[#1a2230] bg-[#090d14] no-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1a2230] bg-[#0e131b]/90 text-[#64748b] font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Admin Email & Name</th>
                <th className="py-3.5 px-4">Role & Access</th>
                <th className="py-3.5 px-4">Security / Lockout</th>
                <th className="py-3.5 px-4">Created Date</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2230]/70">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-xs text-[#64748b]">
                    No operators match your filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const isCurrent = currentAdmin.email === u.email || currentAdmin.id === u.id;
                  const isDeactivated = Boolean(u.isDeactivated);
                  const isLocked = Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date() && !isDeactivated);
                  const isRootSuperadmin = (u.email || '').toLowerCase() === 'admin@hiree.com';
                  const initials = ((u.firstName?.[0] || '') + (u.lastName?.[0] || '')).toUpperCase() || (u.email ? u.email.substring(0, 2).toUpperCase() : 'OP');
                  const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'System Operator';

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-[#131923]/60 transition-colors ${
                        isCurrent
                          ? 'bg-[#0c251b]/15'
                          : isDeactivated
                          ? 'bg-amber-950/10 opacity-75'
                          : ''
                      }`}
                    >
                      {/* Operator column with Avatar, Name, Email */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              isDeactivated
                                ? 'bg-[#1f1710] text-[#f59e0b] border border-[#3d2712]'
                                : u.role === 'SUPERADMIN'
                                ? 'bg-[#261a0c] text-[#f59e0b] border border-[#422b13] shadow-sm shadow-[#f59e0b]/10'
                                : 'bg-[#0c251b] text-[#00d26a] border border-[#123c2a] shadow-sm shadow-[#00d26a]/10'
                            }`}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold text-xs truncate ${isDeactivated ? 'text-[#cbd5e1] line-through decoration-amber-500/60' : 'text-white'}`}>
                                {displayName}
                              </span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-[#00d26a]/15 text-[#00d26a] border border-[#00d26a]/30">
                                  YOU
                                </span>
                              )}
                              {isDeactivated && (
                                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  DEACTIVATED
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-[#94a3b8] font-mono truncate">
                              <span>{u.email || u.username || 'No email registered'}</span>
                              {u.telegramUserId && (
                                <>
                                  <span className="text-[#64748b]">•</span>
                                  <span className="text-[#00d26a] font-bold">TG: {u.telegramUserId}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role & Access Column */}
                      <td className="py-2.5 px-4">
                        {isDeactivated ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#2a1b0e] text-amber-400 border border-[#4a2e15]">
                              <UserX className="w-3 h-3 text-amber-400" />
                              <span>ROLE REVOKED</span>
                            </span>
                            <span className="block text-[10px] text-amber-400/80 font-mono">
                              Held: {u.heldRole || u.role}
                            </span>
                          </div>
                        ) : u.role === 'SUPERADMIN' ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#261a0c] text-[#f59e0b] border border-[#422b13]">
                              <Crown className="w-3 h-3 text-[#f59e0b]" />
                              <span>SUPERADMIN</span>
                            </span>
                            <span className="block text-[10px] text-[#64748b]">Full Root Access</span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0c251b] text-[#00d26a] border border-[#123c2a]">
                              <ShieldCheck className="w-3 h-3 text-[#00d26a]" />
                              <span>ADMIN</span>
                            </span>
                            <span className="block text-[10px] text-[#64748b]">Reviews & Operations</span>
                          </div>
                        )}
                      </td>

                      {/* Security Status */}
                      <td className="py-2.5 px-4">
                        {isDeactivated ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1a1310] text-amber-300 border border-[#3b2315]">
                              <Lock className="w-3 h-3 text-amber-400" />
                              <span>Console Revoked</span>
                            </span>
                            <span className="block text-[10px] text-[#64748b]">Treated as Normal User</span>
                          </div>
                        ) : isLocked ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                              <Lock className="w-3 h-3 text-rose-400" />
                              <span>Account Locked</span>
                            </span>
                            <span className="block text-[10px] text-rose-400/80">Exceeded login attempts</span>
                          </div>
                        ) : u.mustChangePassword ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#261a0c] text-[#f59e0b] border border-[#422b13]">
                              <KeyRound className="w-3 h-3 text-[#f59e0b]" />
                              <span>Must Change Pwd</span>
                            </span>
                            <span className="block text-[10px] text-[#f59e0b]/80">First Login Pending</span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0c251b] text-[#00d26a] border border-[#123c2a]">
                              <CheckCircle className="w-3 h-3 text-[#00d26a]" />
                              <span>Active</span>
                            </span>
                            <span className="block text-[10px] text-[#64748b]">Password Verified</span>
                          </div>
                        )}
                      </td>

                      {/* Registered Date */}
                      <td className="py-2.5 px-4 text-[#94a3b8] text-[11px] font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-[#64748b]" />
                          <span>{new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        </div>
                      </td>

                      {/* Interactive Management Actions */}
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {isSuperadmin && !isCurrent && !isRootSuperadmin && (
                            <>
                              {/* Revoke Role (Deactivate) or Resume Role */}
                              {isDeactivated ? (
                                <button
                                  type="button"
                                  disabled={isProcessingAction === u.id}
                                  onClick={() => void handleResume(u)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-bold text-[11px] inline-flex items-center gap-1 transition-all active:scale-95"
                                  title="Resume Administrator Role & Restore Console Access"
                                >
                                  {isProcessingAction === u.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Power className="w-3 h-3 text-emerald-400" />
                                  )}
                                  <span>Resume</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isProcessingAction === u.id}
                                  onClick={() => void handleDeactivate(u)}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold text-[11px] inline-flex items-center gap-1 transition-all active:scale-95"
                                  title="Revoke Admin Role & Deactivate Console (User treated as normal customer)"
                                >
                                  {isProcessingAction === u.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <UserX className="w-3 h-3 text-amber-400" />
                                  )}
                                  <span>Deactivate</span>
                                </button>
                              )}
                            </>
                          )}

                          {/* Reset Lockout (if failed attempts or locked) */}
                          {isSuperadmin && !isDeactivated && (isLocked || (u.failedAttempts && u.failedAttempts > 0)) && (
                            <button
                              type="button"
                              disabled={isProcessingAction === u.id}
                              onClick={() => void handleUnlock(u)}
                              className="px-2 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-bold text-[11px] inline-flex items-center gap-1 transition-all active:scale-95"
                              title="Reset Failed Attempts and Unlock Operator"
                            >
                              <Unlock className="w-3 h-3 text-rose-400" />
                              <span>Unlock</span>
                            </button>
                          )}

                          {/* Set Temporary Password (SUPERADMIN only) */}
                          {isSuperadmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedUserForResetPassword(u);
                                setResetPasswordValue('');
                              }}
                              className="p-1.5 rounded-lg bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-[#00d26a] border border-[#1a2230] transition-colors"
                              title="Set New Temporary Password"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Delete Account (SUPERADMIN only, non-current, non-root) */}
                          {isSuperadmin && !isCurrent && !isRootSuperadmin && (
                            <button
                              type="button"
                              disabled={isProcessingAction === u.id}
                              onClick={() => void handleDelete(u)}
                              className="p-1.5 rounded-lg bg-[#131923] hover:bg-rose-500/20 text-[#94a3b8] hover:text-rose-400 border border-[#1a2230] transition-colors"
                              title="Permanently Delete Admin Account from Database"
                            >
                              {isProcessingAction === u.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Copy Email */}
                          <button
                            type="button"
                            onClick={() => {
                              if (u.email) {
                                void navigator.clipboard.writeText(u.email);
                                setCopiedEmail(u.email);
                                setTimeout(() => setCopiedEmail(null), 2000);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-white border border-[#1a2230] transition-colors"
                            title="Copy Email"
                          >
                            {copiedEmail === u.email ? (
                              <Check className="w-3.5 h-3.5 text-[#00d26a]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {filteredUsers.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 px-1 border-t border-[#1a2230]">
            <div className="text-xs text-[#94a3b8]">
              Showing <span className="font-bold text-white">{startIndex + 1}</span> to{' '}
              <span className="font-bold text-white">
                {Math.min(startIndex + pageSize, filteredUsers.length)}
              </span>{' '}
              of <span className="font-bold text-white">{filteredUsers.length}</span> operators
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-white font-bold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-[#1a2230]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                  if (totalPages > 5 && Math.abs(pageNum - currentPage) > 2) return null;
                  const isActive = currentPage === pageNum;
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                        isActive
                          ? 'bg-[#00d26a] text-black shadow-md shadow-[#00d26a]/20'
                          : 'text-[#94a3b8] hover:text-white hover:bg-[#131923]'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-black font-extrabold text-xs shadow-md shadow-[#00d26a]/20 transition-all disabled:opacity-40 disabled:bg-[#131923] disabled:text-[#64748b] disabled:shadow-none disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Admin Modal (SUPERADMIN only) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e131b] border border-[#1a2230] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1a2230]">
              <div className="flex items-center gap-2.5 text-white font-extrabold text-base">
                <div className="w-8 h-8 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a]">
                  <UserPlus className="w-4 h-4" />
                </div>
                <span>Create Staff Account</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-xl text-[#94a3b8] hover:text-white hover:bg-[#131923] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div className="p-2.5 rounded-xl bg-[#261a0c] border border-[#422b13] text-[#f59e0b] text-[11px] flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />
                <span><strong>First-Login Policy:</strong> Operator must change this temporary password before accessing console.</span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-300">Telegram User ID *</label>
                  <span className="text-[10px] text-[#00d26a] font-mono">Unforgeable Key</span>
                </div>
                <input
                  type="text"
                  required
                  value={newTelegramId}
                  onChange={(e) => setNewTelegramId(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all font-mono"
                />
                <p className="text-[10px] text-[#64748b] mt-1">
                  Numerical ID of the operator's Telegram account. Binds their authentic Telegram session to staff privileges.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="operator@lottery.et"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Temporary Password *</label>
                <div className="relative">
                  <input
                    type={showCreatePasswordEye ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePasswordEye(!showCreatePasswordEye)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#00d26a] p-1 transition-colors"
                    title={showCreatePasswordEye ? 'Hide password' : 'Show password'}
                  >
                    {showCreatePasswordEye ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-[#64748b]" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Authority Role *</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setNewRole('ADMIN')}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                      newRole === 'ADMIN'
                        ? 'bg-[#0c251b] border-[#00d26a] text-white ring-1 ring-[#00d26a]'
                        : 'bg-[#080b10] border-[#1a2230] text-[#94a3b8] hover:border-[#222e40]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className={`w-4 h-4 ${newRole === 'ADMIN' ? 'text-[#00d26a]' : 'text-[#64748b]'}`} />
                      <span className="font-bold text-xs">ADMIN</span>
                    </div>
                    <span className="text-[10px] text-[#64748b] leading-tight">Operator & Payment Reviewer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewRole('SUPERADMIN')}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                      newRole === 'SUPERADMIN'
                        ? 'bg-[#1c1404] border-amber-400 text-white ring-1 ring-amber-400'
                        : 'bg-[#080b10] border-[#1a2230] text-[#94a3b8] hover:border-[#222e40]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Crown className={`w-4 h-4 ${newRole === 'SUPERADMIN' ? 'text-amber-400' : 'text-[#64748b]'}`} />
                      <span className="font-bold text-xs text-amber-300">SUPERADMIN</span>
                    </div>
                    <span className="text-[10px] text-[#64748b] leading-tight">Full Platform & Settings Control</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">First Name</label>
                  <input
                    type="text"
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    placeholder="e.g. Dawit"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    placeholder="e.g. Bekele"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1a2230]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-white font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingUser}
                  className="px-5 py-2 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-black font-extrabold text-xs shadow-lg shadow-[#00d26a]/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isCreatingUser && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
                  <span>Create Staff Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Temporary Password Modal (SUPERADMIN only) */}
      {selectedUserForResetPassword && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e131b] border border-[#1a2230] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1a2230]">
              <div className="flex items-center gap-2.5 text-white font-extrabold text-base">
                <div className="w-8 h-8 rounded-xl bg-[#261a0c] border border-[#422b13] flex items-center justify-center text-[#f59e0b]">
                  <KeyRound className="w-4 h-4" />
                </div>
                <span>Reset Operator Password</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUserForResetPassword(null);
                  setResetPasswordValue('');
                }}
                className="p-1.5 rounded-xl text-[#94a3b8] hover:text-white hover:bg-[#131923] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div className="p-3 rounded-2xl bg-[#131923] border border-[#1a2230] text-xs space-y-1">
                <span className="text-[#94a3b8] block">Target Operator:</span>
                <span className="font-bold text-white block">
                  {[selectedUserForResetPassword.firstName, selectedUserForResetPassword.lastName].filter(Boolean).join(' ') || selectedUserForResetPassword.username || 'Operator'}
                </span>
                <span className="font-mono text-[11px] text-[#00d26a]">
                  {selectedUserForResetPassword.email}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  New Temporary Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showResetPasswordEye ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="Enter at least 8 characters"
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-[#080b10] border border-[#1a2230] text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPasswordEye(!showResetPasswordEye)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#00d26a] p-1 transition-colors"
                    title={showResetPasswordEye ? 'Hide password' : 'Show password'}
                  >
                    {showResetPasswordEye ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#64748b]" />}
                  </button>
                </div>
                <p className="text-[11px] text-[#94a3b8] mt-1.5">
                  The operator will be required to establish a new private password upon their next login.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1a2230]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUserForResetPassword(null);
                    setResetPasswordValue('');
                  }}
                  className="px-4 py-2 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-white font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResettingPassword || resetPasswordValue.length < 8}
                  className="px-5 py-2 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-black font-extrabold text-xs shadow-lg shadow-[#00d26a]/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isResettingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />}
                  <span>Set Password & Require Reset</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
