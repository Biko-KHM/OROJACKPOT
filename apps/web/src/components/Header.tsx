import React from 'react';
import { Ticket, History, User as UserIcon, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';
import { useAuth } from '../context/AuthContext.js';
import { triggerHaptic } from '../utils/haptics.js';

interface HeaderProps {
  currentTab: 'campaigns' | 'history' | 'my-tickets';
  onSelectTab: (tab: 'campaigns' | 'history' | 'my-tickets') => void;
  onOpenAdmin?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onSelectTab, onOpenAdmin }) => {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();

  const handleSelectLanguage = (lang: 'en' | 'om' | 'am') => {
    triggerHaptic('selection');
    setLanguage(lang);
  };

  const handleTabClick = (tab: 'campaigns' | 'history') => {
    triggerHaptic('light');
    onSelectTab(tab);
  };

  const displayName = user?.firstName || user?.username || 'Player';

  return (
    <header className="sticky top-0 z-40 bg-[#080b10]/95 backdrop-blur-xl border-b border-[#1a2230] shadow-xl pt-safe select-none">
      <div className="max-w-4xl mx-auto px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Brand */}
        <div
          className="flex items-center gap-1.5 sm:gap-2 cursor-pointer active:scale-95 transition-transform shrink-0"
          onClick={() => handleTabClick('campaigns')}
        >
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden p-0.5 bg-gradient-to-tr from-[#00d26a]/50 via-amber-400/30 to-[#00d26a]/40 shadow-md shadow-[#00d26a]/25 shrink-0">
            <img
              src="/logo.png"
              alt="OROJACKPOT"
              className="w-full h-full object-cover rounded-[10px]"
            />
          </div>
          <div className="shrink-0">
            <h1 className="text-sm sm:text-base font-black tracking-tight text-white flex items-center gap-1 sm:gap-1.5 leading-none font-display whitespace-nowrap">
              <span>{t('appTitle')}</span>
              <span className="text-[9px] sm:text-[10px] px-1 py-0.2 sm:px-1.5 sm:py-0.5 rounded-full bg-[#0c251b] text-fulus-green font-black border border-[#123c2a]">
                ETB
              </span>
            </h1>
            <p className="text-[10px] sm:text-xs text-fulus-muted font-medium items-center gap-1 mt-0.5 hidden xs:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d26a] animate-ping inline-block" />
              <span className="truncate max-w-[120px] sm:max-w-none">{t('appMotto')}</span>
            </p>
          </div>
        </div>

        {/* Right side: Minimized trilingual switcher + User badge + Operator shortcut */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Minimized segmented language selector */}
          <div
            className="flex items-center rounded-lg bg-[#0e131b] border border-[#1a2230] p-0.5 shadow-xs text-[10px] sm:text-xs font-bold"
            role="group"
            aria-label="Language Selector"
          >
            <button
              onClick={() => handleSelectLanguage('en')}
              className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-[5px] transition-all ${
                language === 'en'
                  ? 'bg-fulus-green text-white font-black shadow-xs'
                  : 'text-fulus-muted hover:text-white hover:bg-[#131923]'
              }`}
              aria-label="Select English"
            >
              EN
            </button>
            <button
              onClick={() => handleSelectLanguage('om')}
              className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-[5px] transition-all ${
                language === 'om'
                  ? 'bg-fulus-green text-white font-black shadow-xs'
                  : 'text-fulus-muted hover:text-white hover:bg-[#131923]'
              }`}
              aria-label="Select Afaan Oromoo"
            >
              OM
            </button>
            <button
              onClick={() => handleSelectLanguage('am')}
              className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-[5px] transition-all ${
                language === 'am'
                  ? 'bg-fulus-green text-white font-black shadow-xs'
                  : 'text-fulus-muted hover:text-white hover:bg-[#131923]'
              }`}
              aria-label="Select Amharic"
            >
              አማ
            </button>
          </div>

          {/* User badge */}
          <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-[#0e131b] border border-[#1a2230] text-[11px] sm:text-xs text-slate-300">
            <div className="w-3.5 h-3.5 rounded-full bg-[#0c251b] text-fulus-green flex items-center justify-center font-bold text-[10px]">
              <UserIcon className="w-2.5 h-2.5" />
            </div>
            <span className="max-w-[46px] sm:max-w-[75px] truncate font-medium text-[11px] sm:text-xs">
              {displayName}
            </span>
          </div>

          {/* Operator Console Shortcut (Rendered exclusively for verified Admin/Superadmin accounts) */}
          {onOpenAdmin && (
            <button
              onClick={() => {
                triggerHaptic('medium');
                onOpenAdmin();
              }}
              className="flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-[#0c251b] border border-[#123c2a] hover:bg-[#123c2a] text-[#00d26a] text-[11px] sm:text-xs font-bold transition-all active:scale-95 shadow-xs shadow-[#00d26a]/15"
              title="Switch to Operator & Admin Console"
              aria-label="Switch to Operator & Admin Console"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#00d26a] shrink-0" />
              <span className="hidden sm:inline text-[11px] font-extrabold uppercase tracking-wider">Console</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="max-w-4xl mx-auto px-3 sm:px-4 flex items-center gap-1.5 border-t border-[#1a2230] pt-1.5 pb-1.5">
        <button
          onClick={() => handleTabClick('campaigns')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all active:scale-98 ${
            currentTab === 'campaigns'
              ? 'bg-[#0c251b] text-fulus-green border border-[#123c2a] shadow-sm'
              : 'text-fulus-muted hover:text-white hover:bg-[#0e131b]'
          }`}
        >
          <Ticket className="w-4 h-4" />
          <span>{t('campaigns')}</span>
        </button>

        <button
          onClick={() => handleTabClick('history')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all active:scale-98 ${
            currentTab === 'history'
              ? 'bg-[#0c251b] text-fulus-green border border-[#123c2a] shadow-sm'
              : 'text-fulus-muted hover:text-white hover:bg-[#0e131b]'
          }`}
        >
          <History className="w-4 h-4" />
          <span>{t('myTickets')}</span>
        </button>
      </div>
    </header>
  );
};

