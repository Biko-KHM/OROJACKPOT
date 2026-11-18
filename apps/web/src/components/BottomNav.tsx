import React from 'react';
import { Home, History, Info } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics.js';

export type NavTab = 'home' | 'tickets' | 'about';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  const tabs = [
    { id: 'home' as const, label: 'Lotteries', icon: Home },
    { id: 'tickets' as const, label: 'My Tickets', icon: History },
    { id: 'about' as const, label: 'About', icon: Info },
  ];

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
  const activeTabInfo = tabs[activeIndex] || tabs[0];
  const ActiveIcon = activeTabInfo.icon;

  // Visible scooped-notch monotonic S-curve SVG paths: clearly outlines the attractive concave cradle around the ball
  // Tab 0 (Lotteries) center = 60, Tab 1 (My Tickets) center = 180, Tab 2 (About) center = 300
  const notchPaths = [
    'M 24 14 L 31.0 14 C 42.0 14, 49.0 39.5, 60.0 39.5 C 71.0 39.5, 78.0 14, 89.0 14 L 336.0 14 A 24 24 0 0 1 360 38.0 L 360 38.0 A 24 24 0 0 1 336.0 62 L 24 62 A 24 24 0 0 1 0 38.0 L 0 38.0 A 24 24 0 0 1 24 14 Z',
    'M 24 14 L 151.0 14 C 162.0 14, 169.0 39.5, 180.0 39.5 C 191.0 39.5, 198.0 14, 209.0 14 L 336.0 14 A 24 24 0 0 1 360 38.0 L 360 38.0 A 24 24 0 0 1 336.0 62 L 24 62 A 24 24 0 0 1 0 38.0 L 0 38.0 A 24 24 0 0 1 24 14 Z',
    'M 24 14 L 271.0 14 C 282.0 14, 289.0 39.5, 300.0 39.5 C 311.0 39.5, 318.0 14, 329.0 14 L 336.0 14 A 24 24 0 0 1 360 38.0 L 360 38.0 A 24 24 0 0 1 336.0 62 L 24 62 A 24 24 0 0 1 0 38.0 L 0 38.0 A 24 24 0 0 1 24 14 Z',
  ];

  // Percentage horizontal alignments matching exact SVG tab centers (1/6, 1/2, 5/6)
  const leftPositions = ['16.667%', '50.000%', '83.333%'];

  const handleTabClick = (tab: NavTab) => {
    triggerHaptic('selection');
    onSelectTab(tab);
  };

  return (
    <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 max-w-sm sm:max-w-md mx-auto px-3 sm:px-4 pointer-events-none select-none">
      <nav
        className="pointer-events-auto relative w-full h-[65px] select-none"
        role="navigation"
        aria-label="Bottom Navigation"
      >
        {/* 1. Curved Scooped Dock Background with Sharply Defined Hole Outline */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none filter drop-shadow-[0_12px_28px_rgba(0,0,0,0.9)]"
          viewBox="0 0 360 68"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="dockContourStroke" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#26364a" />
              <stop offset="35%" stopColor="#3d526d" />
              <stop offset="65%" stopColor="#3d526d" />
              <stop offset="100%" stopColor="#26364a" />
            </linearGradient>
          </defs>
          <path
            d={notchPaths[activeIndex]}
            stroke="url(#dockContourStroke)"
            strokeWidth="1.75"
            className="fill-[#0e131b]/95 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          />
        </svg>

        {/* 2. Elevated Floating Ball (Compact 40px ball with visible 5px gap in the scooped hole) */}
        <button
          type="button"
          onClick={() => handleTabClick(activeTabInfo.id)}
          style={{ left: leftPositions[activeIndex] }}
          className="pointer-events-auto absolute -top-1.5 -translate-x-1/2 w-10 h-10 rounded-full bg-gradient-to-tr from-[#00d26a] via-[#00e676] to-[#00f2fe] border-2 border-[#090e15] shadow-[0_6px_20px_rgba(0,210,106,0.5)] flex items-center justify-center text-[#041910] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90 z-20"
          title={activeTabInfo.label}
          aria-label={activeTabInfo.label}
        >
          <ActiveIcon className="w-4.5 h-4.5 drop-shadow-sm transition-transform duration-200" />
        </button>

        {/* 3. Navigation Tab Items Grid */}
        <div className="relative z-10 w-full h-full flex items-center justify-between pt-3.5 px-2">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={`flex-1 h-full flex flex-col items-center justify-end pb-2 transition-all duration-200 active:scale-95 ${
                  isActive ? 'text-white' : 'text-[#64748b] hover:text-[#94a3b8]'
                }`}
                title={label}
                aria-label={label}
              >
                {/* When inactive, show subtle icon; when active, show the clean text label under the scoop */}
                {isActive ? (
                  <span className="font-bold text-[10px] sm:text-[11px] tracking-tight text-white mb-0.5 animate-in fade-in zoom-in-95 duration-200">
                    {label}
                  </span>
                ) : (
                  <div className="flex flex-col items-center gap-0.5">
                    <Icon className="w-4.5 h-4.5 transition-transform duration-200" />
                    <span className="text-[9px] sm:text-[10px] font-medium tracking-tight">
                      {label}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

