import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  AlertCircle,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  UserCheck,
  X,
  Sparkles,
} from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import { AdminUser } from '../../types/index.js';
import { triggerHaptic } from '../../utils/haptics.js';

interface SavedAdminAccount {
  email: string;
  name?: string;
  role?: string;
  lastUsedAt: number;
}

const SAVED_ACCOUNTS_KEY = 'tg_admin_saved_accounts';

function getInitials(email: string, name?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const prefix = email.split('@')[0] || 'AD';
  return prefix.slice(0, 2).toUpperCase();
}

export interface AdminLoginProps {
  onLoginSuccess: (admin: AdminUser) => void;
  onBackToApp?: () => void;
  initialEmail?: string;
  telegramUser?: {
    telegramUserId: string;
    username?: string;
    firstName?: string;
    role?: string;
  } | null;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onLoginSuccess,
  onBackToApp,
  initialEmail = '',
  telegramUser,
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberAccount, setRememberAccount] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Load saved accounts from localStorage
  const [savedAccounts, setSavedAccounts] = useState<SavedAdminAccount[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  // Pre-fill email with initialEmail or most recent saved account if email is empty
  useEffect(() => {
    if (!email && savedAccounts.length > 0) {
      setEmail(savedAccounts[0].email);
    }
  }, []);

  const handleSelectSavedAccount = (saved: SavedAdminAccount) => {
    triggerHaptic('selection');
    setEmail(saved.email);
    setErrorMessage(null);
    passwordInputRef.current?.focus();
  };

  const handleRemoveSavedAccount = (e: React.MouseEvent, emailToRemove: string) => {
    e.stopPropagation();
    triggerHaptic('light');
    const updated = savedAccounts.filter(
      (acc) => acc.email.toLowerCase() !== emailToRemove.toLowerCase(),
    );
    setSavedAccounts(updated);
    try {
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    if (email.toLowerCase() === emailToRemove.toLowerCase()) {
      setEmail('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.adminLogin(email, password);

      // Save account to repeated accounts list if rememberAccount is checked
      if (rememberAccount) {
        try {
          const updated: SavedAdminAccount[] = [
            {
              email: res.user.email,
              name:
                [res.user.firstName, res.user.lastName].filter(Boolean).join(' ') ||
                res.user.username ||
                undefined,
              role: res.user.role,
              lastUsedAt: Date.now(),
            },
            ...savedAccounts.filter(
              (acc) => acc.email.toLowerCase() !== res.user.email.toLowerCase(),
            ),
          ].slice(0, 5); // Keep up to 5 recent accounts
          setSavedAccounts(updated);
          localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
      }

      triggerHaptic('success');
      onLoginSuccess(res.user);
    } catch (err) {
      triggerHaptic('error');
      if (err instanceof ApiError) {
        setErrorMessage(err.message || 'Invalid email or password');
      } else {
        setErrorMessage('Failed to connect to authentication service');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080b10] text-slate-100 flex items-center justify-center p-4 selection:bg-[#00d26a]/30 font-sans">
      <div className="w-full max-w-md fulus-card p-6 sm:p-8 shadow-2xl backdrop-blur-xl border border-[#1a2230]">
        {/* Header Icon & Title */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="relative w-20 h-20 mx-auto mb-4 rounded-3xl p-1 bg-gradient-to-tr from-[#00d26a]/40 via-amber-400/30 to-[#00d26a]/40 shadow-xl shadow-[#00d26a]/20">
            <img
              src="/logojackpot.jpg"
              alt="OROJACKPOT"
              className="w-full h-full object-cover rounded-[22px] shadow-inner"
            />
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-white">
            Operator & Admin Portal
          </h1>
          <p className="text-xs text-fulus-muted mt-1">
            OROJACKPOT Management System • Secure Access
          </p>
        </div>

        {/* Telegram Verified Operator Identity Badge */}
        {telegramUser && (
          <div className="mb-6 p-4 rounded-2xl bg-[#0c1925] border border-emerald-500/30 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-[#00d26a] flex items-center justify-center font-bold">
                  <ShieldCheck className="w-5 h-5 text-[#00d26a]" />
                </div>
                <div>
                  <span className="font-bold text-white block text-sm">
                    {telegramUser.firstName || telegramUser.username || 'Operator'}
                  </span>
                  <span className="font-mono text-[11px] text-[#00d26a]">
                    ID: <code>{telegramUser.telegramUserId}</code>
                  </span>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  telegramUser.role === 'SUPERADMIN' || telegramUser.role === 'ADMIN'
                    ? 'bg-emerald-500/20 text-[#00d26a] border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}
              >
                {telegramUser.role || 'STAFF'}
              </span>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-400 leading-relaxed border-t border-slate-800/80 pt-2">
              Identity verified. Please authenticate with your operator email and password below.
            </p>
          </div>
        )}

        {/* Saved Repeated Accounts (Quick Switcher) */}
        {savedAccounts.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2 px-0.5">
              <span className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-[#00d26a]" />
                <span>Saved Accounts ({savedAccounts.length})</span>
              </span>
              {email && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setEmail('');
                    setPassword('');
                  }}
                  className="text-[10.5px] font-semibold text-[#00d26a] hover:underline transition-all"
                >
                  + Different Account
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
              {savedAccounts.map((acc) => {
                const isSelected = email.toLowerCase() === acc.email.toLowerCase();
                const initials = getInitials(acc.email, acc.name);

                return (
                  <div
                    key={acc.email}
                    onClick={() => handleSelectSavedAccount(acc)}
                    className={`group relative p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] ${
                      isSelected
                        ? 'bg-gradient-to-r from-[#0c251b] via-[#102e21] to-[#0c251b] border-[#00d26a]/60 shadow-md shadow-[#00d26a]/10 ring-1 ring-[#00d26a]/40'
                        : 'bg-[#131923] hover:bg-[#18212e] border-[#1a2230] hover:border-[#2a3749]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold font-mono text-xs shrink-0 border transition-all ${
                          isSelected
                            ? 'bg-[#00d26a] text-black border-[#00d26a] shadow-sm'
                            : 'bg-gradient-to-br from-[#1a2230] to-[#0d141f] text-[#00d26a] border-[#222e40] group-hover:border-[#00d26a]/40'
                        }`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-bold text-white truncate leading-tight">
                            {acc.email}
                          </p>
                          {acc.role && (
                            <span className="px-1.5 py-0.2 rounded text-[8.5px] font-black uppercase tracking-wider bg-[#00d26a]/20 text-[#00d26a] border border-[#00d26a]/30 shrink-0">
                              {acc.role}
                            </span>
                          )}
                        </div>
                        {acc.name ? (
                          <p className="text-[10.5px] text-[#94a3b8] truncate mt-0.5">
                            {acc.name}
                          </p>
                        ) : (
                          <p className="text-[10px] text-[#64748b] truncate mt-0.5">
                            Tap to auto-fill
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-[#00d26a] shadow-sm shadow-[#00d26a] animate-pulse mr-1" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleRemoveSavedAccount(e, acc.email)}
                        aria-label={`Remove ${acc.email} from saved accounts`}
                        className="p-1.5 rounded-lg text-[#64748b] hover:text-rose-400 hover:bg-rose-500/15 opacity-60 group-hover:opacity-100 transition-all active:scale-95"
                        title="Forget account"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#94a3b8] mb-1.5 uppercase tracking-wider">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@lottery.et"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#131923] border border-[#1a2230] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
                Password
              </label>
              <button
                type="button"
                data-testid="toggle-password-btn"
                onClick={() => {
                  triggerHaptic('light');
                  setShowPassword((prev) => !prev);
                }}
                className="text-[11px] font-semibold text-[#00d26a] hover:text-[#00bf60] transition-colors flex items-center gap-1 select-none"
                tabIndex={-1}
              >
                {showPassword ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Hide</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>See</span>
                  </>
                )}
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-11 py-3 rounded-xl bg-[#131923] border border-[#1a2230] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setShowPassword((prev) => !prev);
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-[#64748b] hover:text-[#00d26a] hover:bg-[#1a2230] transition-colors active:scale-95 focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember this account toggle */}
          <div className="pt-0.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-[#94a3b8] hover:text-white transition-colors group">
              <input
                type="checkbox"
                checked={rememberAccount}
                onChange={(e) => {
                  triggerHaptic('selection');
                  setRememberAccount(e.target.checked);
                }}
                className="w-4 h-4 rounded-md bg-[#131923] border border-[#1a2230] text-[#00d26a] focus:ring-0 focus:ring-offset-0 checked:bg-[#00d26a] accent-[#00d26a] cursor-pointer"
              />
              <span className="group-hover:text-slate-200 transition-colors flex items-center gap-1.5">
                <span>Remember this account for quick sign-in</span>
                <Sparkles className="w-3 h-3 text-[#00d26a]" />
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className="fulus-btn-primary w-full py-3.5 mt-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#00d26a]/20 active:scale-[0.99]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing In...</span>
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {onBackToApp && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onBackToApp}
              className="text-xs text-[#94a3b8] hover:text-[#00d26a] transition-colors py-1.5 px-3 rounded-xl hover:bg-[#131923] inline-flex items-center gap-1.5 font-medium active:scale-95"
            >
              <span>←</span>
              <span>Back to Customer App</span>
            </button>
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-[#1a2230] text-center">
          <p className="text-[11px] text-[#64748b]">
            Sessions auto-expire after 30 minutes of inactivity. All actions are immutably logged to the cryptographic audit trail.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
