import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.js';
import { CampaignList } from './components/CampaignList.js';
import { NumberGrid } from './components/NumberGrid.js';
import { HoldScreen } from './components/HoldScreen.js';
import { ReservationStatusScreen } from './components/ReservationStatusScreen.js';
import { TicketHistory } from './components/TicketHistory.js';
import { AboutView } from './components/AboutView.js';
import { BottomNav, NavTab } from './components/BottomNav.js';
import { CustomLoader } from './components/CustomLoader.js';
import { LanguageProvider, useLanguage } from './context/LanguageContext.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { CampaignSummary, ReservationDetails, AdminUser } from './types/index.js';
import { api, ApiError, getStoredAdminSession, clearStoredAdminSession } from './api/client.js';
import { AlertTriangle } from 'lucide-react';
import { triggerHaptic } from './utils/haptics.js';

// Lazy-load heavy administrative components to keep customer mini app bundle ultra-lightweight (<80KB)
const AdminLogin = React.lazy(() =>
  import('./components/admin/AdminLogin.js').then((m) => ({ default: m.AdminLogin }))
);
const AdminDashboard = React.lazy(() =>
  import('./components/admin/AdminDashboard.js').then((m) => ({ default: m.AdminDashboard }))
);
const ForceChangePassword = React.lazy(() =>
  import('./components/admin/ForceChangePassword.js').then((m) => ({ default: m.ForceChangePassword }))
);

type Screen = 'campaigns' | 'grid' | 'hold' | 'status' | 'history' | 'about';

// Fast synchronous initial mode resolution without overhead
const getInitialMode = (): 'app' | 'admin' => {
  if (typeof window === 'undefined') return 'app';
  const pathname = window.location.pathname;
  if (pathname.startsWith('/admin')) return 'admin';

  const params = new URLSearchParams(window.location.search);
  const tgStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;

  // Direct operator intent via URL query, startapp param, or operator preference
  if (
    params.get('mode') === 'admin' ||
    params.get('startapp') === 'admin' ||
    tgStartParam === 'admin' ||
    sessionStorage.getItem('preferred_admin_mode') === 'true'
  ) {
    return 'admin';
  }
  return 'app';
};

const MainApp: React.FC = () => {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading, loginAsDemoUser } = useAuth();

  // Mode state: 'app' (Customer Mini App) | 'admin' (Admin Dashboard Portal)
  const [mode, setMode] = useState<'app' | 'admin'>(getInitialMode);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isAdminChecking, setIsAdminChecking] = useState<boolean>(() => {
    return getInitialMode() === 'admin' && Boolean(getStoredAdminSession());
  });

  // Customer Mini App Screens
  const [currentScreen, setCurrentScreen] = useState<Screen>('campaigns');
  const [activeTab, setActiveTab] = useState<'campaigns' | 'history' | 'my-tickets'>('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSummary | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [activeReservation, setActiveReservation] = useState<ReservationDetails | null>(null);
  const [conflictBanner, setConflictBanner] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);
  const [sessionRecoveredBanner, setSessionRecoveredBanner] = useState<boolean>(false);
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({ campaigns: true });

  useEffect(() => {
    if (['campaigns', 'history', 'about'].includes(currentScreen)) {
      setVisitedTabs((prev) => (prev[currentScreen] ? prev : { ...prev, [currentScreen]: true }));
    }
  }, [currentScreen]);

  // Sync mode with browser history and popstate
  const switchMode = (newMode: 'app' | 'admin') => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      const targetPath = newMode === 'admin' ? '/admin' : '/app';
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      setMode(getInitialMode());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check admin session if in admin mode
  useEffect(() => {
    if (mode === 'admin' && !adminUser) {
      const stored = getStoredAdminSession();
      if (!stored) {
        setIsAdminChecking(false);
        return;
      }
      setIsAdminChecking(true);
      void api
        .getAdminMe()
        .then((res) => {
          setAdminUser(res.admin);
        })
        .catch(() => {
          clearStoredAdminSession();
          setAdminUser(null);
        })
        .finally(() => {
          setIsAdminChecking(false);
        });
    }
  }, [mode, adminUser]);

  // Synchronously record staff status without triggering disruptive screen redirection or layout thrashing
  useEffect(() => {
    if (!user) return;
    const isStaffUser = user.role === 'ADMIN' || user.role === 'SUPERADMIN' || user.hasAdminCredential;
    if (isStaffUser) {
      sessionStorage.setItem('is_admin_user', 'true');
    }
  }, [user]);

  // Enterprise Session Continuity: Defer active hold recovery by 1000ms so initial frame renders instantly
  useEffect(() => {
    if (!user || mode === 'admin') return;

    let isMounted = true;
    const timer = setTimeout(() => {
      api
        .getActiveHold()
        .then((res) => {
          if (!isMounted) return;
          if (res.activeHold && res.activeHold.holdExpiresAt) {
            const diffMs = new Date(res.activeHold.holdExpiresAt).getTime() - Date.now();
            if (diffMs > 1000) {
              setActiveReservation(res.activeHold);
              setSessionRecoveredBanner(true);
              triggerHaptic('success');
              // If user opened app on root screen, seamlessly navigate back to their active hold
              setCurrentScreen((prev) => (prev === 'campaigns' ? 'hold' : prev));
            }
          }
        })
        .catch(() => {
          // Resilient silent fallback
        });
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [user, mode]);

  // Parse query params (e.g. ?lottery=slug from Telegram channel link)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const lotterySlug = params.get('lottery');
    if (lotterySlug) {
      void api
        .getOpenCampaigns()
        .then((campaigns) => {
          const match = campaigns.find((c) => c.slug === lotterySlug);
          if (match && match.status === 'OPEN') {
            setSelectedCampaign(match);
            setCurrentScreen('grid');
          }
        })
        .catch(console.error);
    }
  }, []);

  const handleSelectCampaign = (campaign: CampaignSummary) => {
    setSelectedCampaign(campaign);
    setConflictBanner(null);

    // Restore draft ticket selections if user previously picked numbers in this campaign
    try {
      const saved = sessionStorage.getItem(`draft_tickets_${campaign.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedNumbers(parsed);
          triggerHaptic('selection');
        } else {
          setSelectedNumbers([]);
        }
      } else {
        setSelectedNumbers([]);
      }
    } catch {
      setSelectedNumbers([]);
    }

    setCurrentScreen('grid');
  };

  const handleToggleNumber = (num: number) => {
    setConflictBanner(null);
    setSelectedNumbers((prev) => {
      const next = prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num];
      if (selectedCampaign) {
        try {
          if (next.length > 0) {
            sessionStorage.setItem(`draft_tickets_${selectedCampaign.id}`, JSON.stringify(next));
          } else {
            sessionStorage.removeItem(`draft_tickets_${selectedCampaign.id}`);
          }
        } catch {
          // ignore storage error
        }
      }
      return next;
    });
  };

  const handleCheckout = async () => {
    if (!selectedCampaign || selectedNumbers.length === 0 || isCheckingOut) return;

    setConflictBanner(null);
    setIsCheckingOut(true);

    try {
      const reservation = await api.createReservation(selectedCampaign.id, selectedNumbers);
      setActiveReservation(reservation);
      setSelectedNumbers([]);
      if (selectedCampaign) {
        try {
          sessionStorage.removeItem(`draft_tickets_${selectedCampaign.id}`);
        } catch {
          // ignore
        }
      }
      setCurrentScreen('hold');
    } catch (err: unknown) {
      triggerHaptic('error');
      if (err instanceof ApiError) {
        if (
          err.status === 409 &&
          err.code !== 'RESERVATION_LIMIT_EXCEEDED' &&
          err.code !== 'CAMPAIGN_NOT_OPEN' &&
          err.code !== 'CAMPAIGN_ENDED'
        ) {
          setConflictBanner(t('conflictError'));
          setSelectedNumbers([]); // reset selected numbers so user can re-pick
        } else if (err.code === 'RESERVATION_LIMIT_EXCEEDED') {
          setConflictBanner(
            err.message ||
              'Maximum active reservations reached. Please complete payment on your existing hold or cancel it first.',
          );
        } else if (err.status === 401) {
          setConflictBanner('Session expired or unauthorized. Please re-open the mini app or refresh.');
        } else {
          setConflictBanner(err.message || 'Reservation failed. Please try again.');
        }
      } else {
        const rawMsg = err instanceof Error ? err.message : 'Reservation failed';
        const msg = /failed to fetch|networkerror|load failed/i.test(rawMsg)
          ? 'Network connection error. Please ensure the backend server is reachable and try again.'
          : rawMsg;
        setConflictBanner(msg);
      }
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleTabSelect = (tab: 'campaigns' | 'history' | 'my-tickets') => {
    setActiveTab(tab);
    if (tab === 'campaigns') {
      setCurrentScreen('campaigns');
    } else if (tab === 'history') {
      setCurrentScreen('history');
    }
  };

  // --------------------------------------------------------------------------
  // Telegram Native BackButton & Closing Confirmation Lifecycle
  // --------------------------------------------------------------------------
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

    // Disable closing confirmation when user returns home or is not on the Hold countdown screen
    if (currentScreen !== 'hold' && tg?.disableClosingConfirmation) {
      tg.disableClosingConfirmation();
    }

    if (!tg?.BackButton) return;

    // Root screen: CampaignList in app mode
    const isRoot = mode === 'app' && currentScreen === 'campaigns';

    if (isRoot) {
      tg.BackButton.hide();
      return;
    }

    // On nested screens (NumberGrid, HoldScreen, TicketHistory, AboutView, Admin mode):
    // show BackButton and bind native Telegram onBack click handler.
    const handleNativeBack = () => {
      triggerHaptic('light');

      if (mode === 'admin') {
        switchMode('app');
        return;
      }

      if (currentScreen === 'grid') {
        setCurrentScreen('campaigns');
      } else if (currentScreen === 'hold') {
        // Confirm before releasing numbers if active countdown is running
        if (confirm('Cancel your ticket hold and return to campaign list?')) {
          if (tg.disableClosingConfirmation) {
            tg.disableClosingConfirmation();
          }
          if (activeReservation) {
            void api.cancelReservation(activeReservation.id).catch(() => {});
          }
          setActiveReservation(null);
          setCurrentScreen('campaigns');
        }
      } else if (currentScreen === 'status') {
        setActiveReservation(null);
        setCurrentScreen('campaigns');
      } else if (currentScreen === 'history' || currentScreen === 'about') {
        setCurrentScreen('campaigns');
        setActiveTab('campaigns');
      } else {
        setCurrentScreen('campaigns');
      }
    };

    tg.BackButton.show();
    tg.BackButton.onClick(handleNativeBack);

    return () => {
      tg.BackButton.offClick(handleNativeBack);
    };
  }, [mode, currentScreen, activeReservation]);

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // ADMIN PORTAL MODE ROUTE (Code-split with React.Suspense)
  // --------------------------------------------------------------------------
  if (mode === 'admin') {
    if (isAdminChecking) {
      return (
        <CustomLoader
          message="Verifying session"
          subtitle="Operator & Admin Portal"
        />
      );
    }

    return (
      <React.Suspense
        fallback={
          <CustomLoader
            message="Loading Operator Portal"
            subtitle="HIREE Management System"
          />
        }
      >
        {!adminUser ? (
          <AdminLogin
            onLoginSuccess={(admin) => {
              setAdminUser(admin);
            }}
            onBackToApp={() => {
              sessionStorage.removeItem('preferred_admin_mode');
              switchMode('app');
            }}
            initialEmail={user?.adminEmail || ''}
            telegramUser={user}
          />
        ) : adminUser.mustChangePassword ? (
          <ForceChangePassword
            admin={adminUser}
            onSuccess={() => {
              setAdminUser({ ...adminUser, mustChangePassword: false });
            }}
            onLogout={async () => {
              try {
                await api.adminLogout();
              } catch {
                // ignore
              }
              setAdminUser(null);
            }}
          />
        ) : (
          <AdminDashboard
            admin={adminUser}
            onLogout={() => {
              setAdminUser(null);
            }}
            onSwitchToMiniApp={() => {
              sessionStorage.removeItem('preferred_admin_mode');
              switchMode('app');
            }}
          />
        )}
      </React.Suspense>
    );
  }

  // --------------------------------------------------------------------------
  // CUSTOMER MINI APP MODE ROUTE
  // --------------------------------------------------------------------------
  if (isAuthLoading) {
    return (
      <CustomLoader
        message="Getting things ready"
        subtitle="HIREE Lottery • Your chance. Your destiny."
      />
    );
  }

  // Map current screen to BottomNav active tab
  const getActiveBottomTab = (): NavTab => {
    if (currentScreen === 'history') return 'tickets';
    if (currentScreen === 'about') return 'about';
    return 'home';
  };

  const handleBottomNavSelect = (tab: NavTab) => {
    if (tab === 'home') {
      setCurrentScreen('campaigns');
      setActiveTab('campaigns');
    } else if (tab === 'tickets') {
      setCurrentScreen('history');
      setActiveTab('history');
    } else if (tab === 'about') {
      setCurrentScreen('about');
    }
  };

  // Senior Dev Telegram ID check: pure in-memory equality (<0.001ms, zero overhead)
  const configuredSuperAdminTgId = import.meta.env.VITE_SUPERADMIN_TELEGRAM_ID;
  const tgUserId = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : undefined;
  const isSuperadminByTgId = Boolean(
    configuredSuperAdminTgId && tgUserId && String(tgUserId) === String(configuredSuperAdminTgId)
  );

  // Administrative verification (Telegram ID environment binding OR database authenticated role)
  const isUserAdmin = Boolean(
    isSuperadminByTgId ||
      (user && (user.role === 'ADMIN' || user.role === 'SUPERADMIN' || user.hasAdminCredential))
  );

  // Graceful guest/demo fallback if opened outside Telegram client
  if (!user) {
    return (
      <div className="min-h-[100dvh] bg-[#080b10] text-slate-100 flex flex-col justify-between font-sans select-none">
        <Header
          currentTab={activeTab}
          onSelectTab={handleTabSelect}
        />
        <div className="max-w-md mx-auto p-4 sm:p-6 text-center space-y-4 my-auto w-full px-4">
          <div className="ticket-stub p-6 space-y-4 shadow-2xl bg-gradient-to-b from-[#0e141f] to-[#080b10]">
            <div className="fulus-icon-box-green w-16 h-16 mx-auto shadow-lg shadow-[#00d26a]/20">
              <span className="text-3xl">🎟</span>
            </div>
            <h2 className="text-xl font-black text-white font-display tracking-tight">{t('appTitle')}</h2>
            <p className="text-xs text-fulus-muted leading-relaxed">
              Launch this app inside Telegram for instant account sync, or continue to browse campaigns.
            </p>
            <div className="space-y-2.5 pt-2">
              <a
                href={`https://t.me/${(typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGRAM_BOT_USERNAME) || 'HireeLotteryBot'}/app`}
                target="_blank"
                rel="noopener noreferrer"
                className="fulus-btn-primary w-full py-3.5 rounded-xl font-bold text-xs sm:text-sm active:scale-95 shadow-xl flex items-center justify-center gap-2"
              >
                <span>Open in Telegram</span>
                <span>↗</span>
              </a>

              <button
                type="button"
                onClick={() => void loginAsDemoUser()}
                className="w-full py-2.5 rounded-xl text-xs font-semibold text-[#94a3b8] hover:text-white transition-colors border border-[#1a2230] hover:border-[#222e40] bg-[#131923] active:scale-95"
              >
                Continue to Mini App
              </button>
            </div>
          </div>
        </div>
        <div className="p-4 text-center text-[10px] text-fulus-dim font-medium pb-safe">
          HIREE Lottery • Your chance. Your destiny.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#080b10] text-slate-100 flex flex-col font-sans selection:bg-[#00d26a]/30">
      {currentScreen !== 'grid' && (
        <Header
          currentTab={activeTab}
          onSelectTab={handleTabSelect}
          onOpenAdmin={isUserAdmin ? () => switchMode('admin') : undefined}
        />
      )}

      {/* Executive Staff Workspace Bar (Rendered exclusively for verified Admin / Superadmin accounts) */}
      {isUserAdmin && currentScreen !== 'grid' && (
        <div className="max-w-4xl mx-auto my-2 px-3 sm:px-4 w-full">
          <div className="p-3 rounded-2xl bg-gradient-to-r from-[#0c251b] via-[#0e1d17] to-[#0c251b] border border-[#123c2a] shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#00d26a]/15 text-[#00d26a] flex items-center justify-center font-black text-sm shrink-0 border border-[#00d26a]/30">
                🛡️
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs sm:text-sm font-bold text-white tracking-tight">Staff Account Verified</span>
                  <span className="px-2 py-0.5 rounded-full text-[10.5px] font-black bg-[#00d26a]/20 text-[#00d26a] border border-[#00d26a]/40">
                    {user?.role || 'SUPERADMIN'}
                  </span>
                </div>
                <p className="text-xs text-[#94a3b8] truncate mt-0.5">
                  Telegram ID: <span className="font-mono text-[#00d26a] font-bold">{user?.telegramUserId || (tgUserId ? String(tgUserId) : 'Verified')}</span>
                  {user?.mustChangePassword && <span className="text-amber-400 font-semibold ml-1.5">• First-Time Setup Required</span>}
                </p>
              </div>
            </div>

            <button
              onClick={() => switchMode('admin')}
              className="px-3.5 py-2 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-black font-extrabold text-xs sm:text-sm shrink-0 flex items-center gap-1.5 shadow-md shadow-[#00d26a]/20 transition-all active:scale-95"
            >
              <span>{user?.mustChangePassword ? 'Setup Console' : 'Open Console'}</span>
              <span>→</span>
            </button>
          </div>
        </div>
      )}



      {/* Session Recovery Notification Banner */}
      {sessionRecoveredBanner && activeReservation && (
        <div className="max-w-2xl mx-auto my-2.5 px-3 sm:px-4 w-full">
          <div className="p-3 sm:p-3.5 rounded-2xl bg-[#00d26a]/15 border border-[#00d26a]/40 text-[#00d26a] text-xs flex items-center justify-between gap-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm">⚡</span>
              <div>
                <span className="font-bold block text-white">Active Hold Session Restored</span>
                <span className="text-[11px] text-[#94a3b8]">
                  Resumed your ticket hold ({activeReservation.ticketCount} {activeReservation.ticketCount === 1 ? 'ticket' : 'tickets'})
                </span>
              </div>
            </div>
            <button
              onClick={() => setSessionRecoveredBanner(false)}
              className="text-[#94a3b8] hover:text-white font-bold text-xs p-1 active:scale-95"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 409 Conflict Banner */}
      {conflictBanner && (
        <div className="max-w-2xl mx-auto my-3 px-3 sm:px-4 w-full">
          <div className="p-3 sm:p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 shadow-lg animate-pulse">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block mb-0.5">Tickets Taken</span>
              <span>{conflictBanner}</span>
            </div>
            <button
              onClick={() => setConflictBanner(null)}
              className="text-amber-400 hover:text-white font-bold text-xs p-1 active:scale-95"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Screen Router with High-Performance Tab State Preservation (Instant 0ms tab switch & preserved scroll) */}
      <main className="flex-1">
        {/* Campaigns Tab (Always preserved to maintain scroll & prevent redundant network refetches) */}
        <div className={currentScreen === 'campaigns' ? 'block' : 'hidden'}>
          <CampaignList onSelectCampaign={handleSelectCampaign} />
        </div>

        {/* Ticket History Tab (Lazily mounted on first tap, then preserved) */}
        <div className={currentScreen === 'history' ? 'block' : 'hidden'}>
          {visitedTabs.history && (
            <TicketHistory
              onExploreCampaigns={() => {
                setCurrentScreen('campaigns');
                setActiveTab('campaigns');
              }}
            />
          )}
        </div>

        {/* About Tab (Lazily mounted on first tap, then preserved) */}
        <div className={currentScreen === 'about' ? 'block' : 'hidden'}>
          {visitedTabs.about && <AboutView />}
        </div>

        {/* Action / Checkout Flow Screens (Mounted only when active) */}
        {currentScreen === 'grid' && selectedCampaign && (
          <NumberGrid
            campaign={selectedCampaign}
            selectedNumbers={selectedNumbers}
            onToggleNumber={handleToggleNumber}
            onBack={() => setCurrentScreen('campaigns')}
            onCheckout={handleCheckout}
            isCheckingOut={isCheckingOut}
            conflictBanner={conflictBanner}
            onClearConflictBanner={() => setConflictBanner(null)}
          />
        )}

        {currentScreen === 'hold' && activeReservation && (
          <HoldScreen
            reservation={activeReservation}
            onPaymentSubmitted={() => setCurrentScreen('status')}
            onHoldCancelled={() => {
              setActiveReservation(null);
              setCurrentScreen('campaigns');
            }}
          />
        )}

        {currentScreen === 'status' && activeReservation && (
          <ReservationStatusScreen
            reservationId={activeReservation.id}
            onGoHome={() => {
              setActiveReservation(null);
              setCurrentScreen('campaigns');
            }}
          />
        )}
      </main>

      {/* Floating Active Hold Resumption Dock (persists when browsing other screens) */}
      {activeReservation && currentScreen !== 'hold' && currentScreen !== 'status' && (
        <div className="fixed bottom-24 left-3 right-3 sm:left-auto sm:right-6 sm:w-96 z-40 pointer-events-auto">
          <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-[#1c1404] via-[#241a05] to-[#1c1404] border border-amber-500/50 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm shrink-0 border border-amber-500/40 animate-pulse">
                ⚡
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-300 truncate">
                  Active Hold ({activeReservation.ticketCount} {activeReservation.ticketCount === 1 ? 'ticket' : 'tickets'})
                </p>
                <p className="text-[10.5px] text-amber-200/80 truncate">
                  Complete payment to finalize tickets • In Progress
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                triggerHaptic('light');
                setCurrentScreen('hold');
              }}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-xs shrink-0 shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
            >
              Resume →
            </button>
          </div>
        </div>
      )}

      {/* Floating Bottom Navigation Dock (FulusApp Style) */}
      <BottomNav
        activeTab={getActiveBottomTab()}
        onSelectTab={handleBottomNavSelect}
      />
    </div>
  );

};

export const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
