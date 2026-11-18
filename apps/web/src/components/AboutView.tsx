import React from 'react';
import { MessageCircle, ShieldCheck, CheckCircle2, HelpCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';

export const AboutView: React.FC = () => {
  const { t } = useLanguage();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 text-slate-100 pb-28">
      {/* Platform Description Card */}
      <div className="fulus-card p-6 space-y-4">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-tr from-[#00d26a]/50 via-amber-400/30 to-[#00d26a]/40 shadow-lg shadow-[#00d26a]/20 shrink-0">
            <img src="/logo.png" alt="HIREE" className="w-full h-full object-cover rounded-[14px]" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">{t('appTitle')}</h2>
            <p className="text-xs text-fulus-muted">{t('appMotto')}</p>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-fulus-muted leading-relaxed">
          {t('appTitle')} is an official, cryptographically verifiable lottery platform built
          specifically for Telegram. Players can select transparent lottery numbers, hold tickets
          securely, pay via Ethiopian banks (CBE, Telebirr, or Awash Bank), and verify draws using
          verifiable SHA-256 cryptographic hashes.
        </p>

        <div className="pt-2 border-t border-fulus-border space-y-3">
          <h3 className="text-sm font-extrabold text-white">How it works</h3>
          <p className="text-xs text-fulus-muted leading-relaxed">
            Choose an active lottery campaign, pick your lucky ticket numbers from the virtualized
            transparent pool, and submit your payment proof. Once confirmed by our administrative
            team, your ticket numbers are locked into the automated, provably fair cryptographic
            draw engine.
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="fulus-card-nested p-3.5 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-fulus-green shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-white block">Provably Fair</span>
              <span className="text-fulus-muted text-[11px]">SHA-256 seed commit verification</span>
            </div>
          </div>
          <div className="fulus-card-nested p-3.5 flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-fulus-green shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-white block">Instant Verification</span>
              <span className="text-fulus-muted text-[11px]">Telebirr & CBE manual review</span>
            </div>
          </div>
        </div>
      </div>

      {/* Need Help / Support Card (Matching Fulus Screenshot 4) */}
      <div className="fulus-card p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="fulus-icon-box-green w-12 h-12">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white leading-snug">Need help?</h4>
            <p className="text-xs text-fulus-muted truncate">Contact our support team</p>
          </div>
        </div>

        <a
          href="https://t.me/FulusAppSupportBot"
          target="_blank"
          rel="noopener noreferrer"
          className="fulus-btn-primary shrink-0"
        >
          Contact
        </a>
      </div>

      {/* Rules & FAQ Card */}
      <div className="fulus-card p-5 space-y-3">
        <h4 className="text-sm font-extrabold text-white flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-fulus-green" />
          <span>Rules & Guarantees</span>
        </h4>
        <ul className="text-xs text-fulus-muted space-y-2 list-disc list-inside">
          <li>Hold windows reserve your tickets exclusively for 10 minutes.</li>
          <li>If a lottery fails to sell out by deadline, full refunds are issued.</li>
          <li>Winners are drawn automatically using PostgreSQL crypto-random seed generators.</li>
        </ul>
      </div>
    </div>
  );
};
