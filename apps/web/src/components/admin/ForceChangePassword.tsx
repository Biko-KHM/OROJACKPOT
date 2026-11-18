import React, { useState } from 'react';
import { ShieldAlert, Lock, Check, AlertCircle, Loader2, LogOut, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import { AdminUser } from '../../types/index.js';

interface ForceChangePasswordProps {
  admin: AdminUser;
  onSuccess: () => void;
  onLogout: () => void;
}

export const ForceChangePassword: React.FC<ForceChangePasswordProps> = ({
  admin,
  onSuccess,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const hasMinLength = newPassword.length >= 8;
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isValid = hasMinLength && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await api.adminChangePassword(newPassword, currentPassword || undefined);
      setSuccessMessage('Password successfully updated! Redirecting to dashboard...');
      setTimeout(() => {
        onSuccess();
      }, 1200);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message || 'Failed to update password');
      } else {
        setErrorMessage('Failed to connect to authentication service');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080b10] text-slate-100 flex items-center justify-center p-4 selection:bg-[#00d26a]/30 font-sans">
      <div className="w-full max-w-md fulus-card p-8 shadow-2xl border border-[#1a2230]">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4 bg-[#261a0c] border border-[#422b13] shadow-lg shadow-[#f59e0b]/15">
            <ShieldAlert className="w-8 h-8 text-[#f59e0b]" />
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-white">
            Mandatory Password Update
          </h1>
          <p className="text-xs text-fulus-muted mt-1">
            First Login Security Requirement • {admin.email}
          </p>
        </div>

        <div className="mb-6 p-3.5 rounded-2xl bg-[#261a0c] border border-[#422b13] text-[#f59e0b] text-xs leading-relaxed">
          <span className="font-extrabold block mb-1">Temporary Password In Use</span>
          Your account was provisioned with a temporary administrator password. For system
          security and regulatory compliance, you must establish a new private password before
          accessing the lottery management portal.
        </div>

        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-[#0c251b] border border-[#123c2a] text-[#00d26a] text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00d26a]" />
            <span className="flex-1 font-bold">{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#94a3b8] uppercase tracking-wider">
                Current Temporary Password
              </label>
              <span className="text-[10px] text-amber-400 font-medium">Optional for first-login reset</span>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter temporary password"
                className="w-full pl-10 pr-11 py-3 rounded-xl bg-[#131923] border border-[#1a2230] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#00d26a] p-1 transition-colors"
                title={showCurrentPassword ? 'Hide password' : 'Show password'}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#64748b]" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#94a3b8] mb-1.5 uppercase tracking-wider">
              New Private Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showNewPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full pl-10 pr-11 py-3 rounded-xl bg-[#131923] border border-[#1a2230] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#00d26a] p-1 transition-colors"
                title={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#64748b]" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#94a3b8] mb-1.5 uppercase tracking-wider">
              Confirm New Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full pl-10 pr-11 py-3 rounded-xl bg-[#131923] border border-[#1a2230] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#00d26a] p-1 transition-colors"
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#64748b]" />}
              </button>
            </div>
          </div>

          {/* Password Validation Checklist */}
          <div className="p-3 rounded-xl bg-[#080b10] border border-[#1a2230] space-y-1.5 text-[11px]">
            <div className={`flex items-center gap-2 ${hasMinLength ? 'text-[#00d26a]' : 'text-[#64748b]'}`}>
              <Check className={`w-3.5 h-3.5 ${hasMinLength ? 'opacity-100' : 'opacity-30'}`} />
              <span>At least 8 characters in length</span>
            </div>
            <div className={`flex items-center gap-2 ${hasNumber ? 'text-[#00d26a]' : 'text-[#64748b]'}`}>
              <Check className={`w-3.5 h-3.5 ${hasNumber ? 'opacity-100' : 'opacity-30'}`} />
              <span>Contains at least one number</span>
            </div>
            <div className={`flex items-center gap-2 ${hasSpecial ? 'text-[#00d26a]' : 'text-[#64748b]'}`}>
              <Check className={`w-3.5 h-3.5 ${hasSpecial ? 'opacity-100' : 'opacity-30'}`} />
              <span>Contains special character (e.g. !@#$)</span>
            </div>
            <div className={`flex items-center gap-2 ${passwordsMatch ? 'text-[#00d26a]' : 'text-[#64748b]'}`}>
              <Check className={`w-3.5 h-3.5 ${passwordsMatch ? 'opacity-100' : 'opacity-30'}`} />
              <span>Passwords match</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !isValid}
            className="fulus-btn-primary w-full py-3.5 mt-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Updating Password...</span>
              </>
            ) : (
              <span>Update Password & Enter Portal</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#1a2230] flex items-center justify-between text-[11px] text-[#64748b]">
          <span>Need help? Contact Superadmin</span>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 text-rose-400 hover:text-rose-300 font-bold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
