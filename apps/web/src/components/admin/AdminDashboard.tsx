import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Layers,
  Package,
  CheckSquare,
  Ticket,
  Users,
  Settings,
  LogOut,
  ExternalLink,
  Search,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { AdminUser } from '../../types/index.js';
import { api } from '../../api/client.js';
import { triggerHaptic } from '../../utils/haptics.js';
import { AdminOverviewView } from './AdminOverviewView.js';
import { CampaignsView } from './CampaignsView.js';
import { RefundsView } from './RefundsView.js';
import { InventoryView } from './InventoryView.js';
import { PaymentReviewsView } from './PaymentReviewsView.js';
import { ReservationsView } from './ReservationsView.js';
import { CustomersView } from './CustomersView.js';
import { SettingsView } from './SettingsView.js';

interface AdminDashboardProps {
  admin: AdminUser;
  onLogout: () => void;
  onSwitchToMiniApp: () => void;
}

export type AdminTab =
  | 'overview'
  | 'campaigns'
  | 'refunds'
  | 'inventory'
  | 'reviews'
  | 'reservations'
  | 'customers'
  | 'settings';

interface NavItem {
  id: AdminTab;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', shortLabel: 'Campaigns', icon: Layers },
  { id: 'reviews', label: 'Payment Reviews', shortLabel: 'Reviews', icon: CheckSquare },
  { id: 'inventory', label: 'Inventory', shortLabel: 'Inventory', icon: Package },
  { id: 'reservations', label: 'Reservations', shortLabel: 'Reservations', icon: Ticket },
  { id: 'customers', label: 'Customers', shortLabel: 'Customers', icon: Users },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

/**
 * Mobile navigation items: combines Reservations and Customers into a single button,
 * and positions Reviews right next to Campaigns.
 */
const MOBILE_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', shortLabel: 'Campaigns', icon: Layers },
  { id: 'reviews', label: 'Payment Reviews', shortLabel: 'Reviews', icon: CheckSquare },
  { id: 'inventory', label: 'Inventory', shortLabel: 'Inventory', icon: Package },
  { id: 'customers', label: 'Customers & Reservations', shortLabel: 'Customers', icon: Users },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

/**
 * Hook to dynamically track whether the user is on a desktop/PC viewport (>= 1024px)
 * or accessing via mobile phone / Telegram Mini App (< 1024px).
 */
const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 1024;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isDesktop;
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackViewName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AdminErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Admin view render error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.fallbackViewName !== this.props.fallbackViewName && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-3xl bg-[#131923] border border-rose-500/30 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">View Load Interrupted</h3>
            <p className="text-xs text-[#94a3b8] mt-1 max-w-md mx-auto">
              An unexpected condition occurred while loading {this.props.fallbackViewName || 'this page'}. The rest of the dashboard remains operational.
            </p>
            {this.state.error?.message && (
              <p className="font-mono text-[11px] text-rose-300 mt-2 bg-rose-500/10 py-1.5 px-3 rounded-xl border border-rose-500/20 inline-block">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-xl bg-[#00d26a] hover:bg-[#00bf60] text-white font-bold text-xs transition-colors shadow-lg shadow-[#00d26a]/20"
            >
              Retry View
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  admin,
  onLogout,
  onSwitchToMiniApp,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [inspectLotteryId, setInspectLotteryId] = useState<string | undefined>(undefined);
  const [inspectLotteryTitle, setInspectLotteryTitle] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pendingReviewsCount, setPendingReviewsCount] = useState<number | null>(null);

  // Dynamic desktop check: sidebar is rendered exclusively on desktop PC viewports (>= 1024px)
  const isDesktop = useIsDesktop();

  // Poll / fetch overview on mount to display badge on Payment Reviews
  useEffect(() => {
    void api
      .getAdminOverview()
      .then((data) => {
        if (data && typeof data.pendingReviewsCount === 'number') {
          setPendingReviewsCount(data.pendingReviewsCount);
        }
      })
      .catch(() => {});
  }, [activeTab]);

  const handleInspectInventory = (lotteryId: string, title: string) => {
    setInspectLotteryId(lotteryId);
    setInspectLotteryTitle(title);
    setActiveTab('inventory');
    triggerHaptic('selection');
  };

  const handleSelectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    triggerHaptic('selection');
  };

  const handleLogout = async () => {
    try {
      await api.adminLogout();
    } catch {
      // ignore
    } finally {
      onLogout();
    }
  };

  const currentItem = NAV_ITEMS.find((item) => item.id === activeTab) || NAV_ITEMS[0];

  const navItemsWithBadges = NAV_ITEMS.map((item) => {
    if (item.id === 'reviews' && pendingReviewsCount && pendingReviewsCount > 0) {
      return { ...item, badge: `${pendingReviewsCount}` };
    }
    if (item.id === 'settings' && admin.role !== 'SUPERADMIN') {
      return { ...item, badge: 'View' };
    }
    return item;
  });

  const mobileNavItemsWithBadges = MOBILE_NAV_ITEMS.map((item) => {
    if (item.id === 'reviews' && pendingReviewsCount && pendingReviewsCount > 0) {
      return { ...item, badge: `${pendingReviewsCount}` };
    }
    if (item.id === 'settings' && admin.role !== 'SUPERADMIN') {
      return { ...item, badge: 'View' };
    }
    return item;
  });

  const filteredNavItems = navItemsWithBadges.filter((item) => {
    if (!searchQuery.trim()) return true;
    return item.label.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="h-screen w-full bg-[#080b10] text-slate-100 flex p-0 lg:p-3.5 lg:gap-3 overflow-hidden font-sans selection:bg-[#00d26a]/30">
      {/* -------------------------------------------------------------------------- */}
      {/* Desktop Sidebar: ONLY shown when user logs into website through desktop/PC */}
      {/* -------------------------------------------------------------------------- */}
      {isDesktop && (
        <aside
          role="navigation"
          aria-label="Admin Desktop Sidebar"
          className="hidden lg:flex w-60 xl:w-64 bg-[#0e131b] border border-[#1a2230] rounded-3xl flex-col justify-between p-3 sm:p-3.5 shadow-2xl backdrop-blur-xl shrink-0"
        >
          {/* Top: Logo & Brand */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2">
              <div className="flex items-center gap-2.5">
                {/* Luxury Logo Badge */}
                <div className="relative w-9 h-9 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-tr from-[#00d26a]/50 via-amber-400/30 to-[#00d26a]/40 shadow-md shadow-[#00d26a]/15 shrink-0">
                  <img src="/logojackpot.jpg" alt="OROJACKPOT" className="w-full h-full object-cover rounded-[12px]" />
                </div>

                <div>
                  <h1 className="text-sm font-extrabold font-display tracking-tight text-white flex items-center gap-1.5 leading-none">
                    <span>OROJACKPOT</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#0c251b] text-[#00d26a] font-bold border border-[#123c2a]">
                      Portal
                    </span>
                  </h1>
                  <p className="text-[9.5px] text-[#00d26a] font-semibold tracking-wide uppercase mt-0.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00d26a] animate-pulse" />
                    <span>{admin.role === 'SUPERADMIN' ? 'Superadmin' : 'Coordinator'}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Divider line under brand */}
            <div className="h-px bg-[#1a2230] mx-1 mb-2" />

            {/* Navigation Items */}
            <nav className="space-y-0.5 xl:space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filteredNavItems.length === 0 ? (
                <div className="py-4 px-2 text-center text-xs text-[#64748b]">
                  No matching views
                </div>
              ) : (
                filteredNavItems.map(({ id, label, icon: Icon, badge }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={`desktop-${id}`}
                      onClick={() => handleSelectTab(id)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 xl:py-2 rounded-xl font-semibold text-xs transition-all text-left group ${
                        isActive
                          ? 'bg-[#00d26a] text-white font-bold shadow-md shadow-[#00d26a]/20'
                          : 'text-[#94a3b8] hover:text-white hover:bg-[#131923]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 transition-colors ${
                            isActive
                              ? 'text-white'
                              : 'text-[#64748b] group-hover:text-[#00d26a]'
                          }`}
                        />
                        <span className="tracking-wide text-[11.5px] xl:text-xs truncate">{label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] animate-pulse" />
                        )}
                        {badge && (
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-bold rounded-full ${
                              isActive
                                ? 'bg-black/25 text-white'
                                : id === 'reviews'
                                ? 'bg-[#261a0c] text-[#f59e0b] border border-[#422b13]'
                                : 'bg-[#0c251b] text-[#00d26a] border border-[#123c2a]'
                            }`}
                          >
                            {badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </nav>
          </div>

          {/* Bottom Section: Customer View & Logout Button */}
          <div className="pt-2.5 border-t border-[#1a2230] space-y-1.5 px-1 mt-2">
            {/* Quick link to Customer Mini App */}
            <button
              onClick={onSwitchToMiniApp}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-[#131923] hover:bg-[#1a2230] text-[#94a3b8] hover:text-white text-[11px] font-medium transition-all border border-[#1a2230]"
              title="Open Customer Mini App View"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#00d26a] shrink-0" />
                <span>Customer View</span>
              </span>
              <ExternalLink className="w-3 h-3 text-[#64748b] shrink-0" />
            </button>

            {/* Minimalist Logout Button */}
            <button
              onClick={() => void handleLogout()}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[#94a3b8] hover:text-rose-400 hover:bg-rose-500/10 rounded-xl text-[11px] font-semibold transition-all group"
              title="Log Out"
            >
              <LogOut className="w-3.5 h-3.5 text-[#64748b] group-hover:text-rose-400 transition-colors transform -rotate-180 shrink-0" />
              <span>Logout</span>
            </button>
          </div>
        </aside>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* Main Content Area                                                         */}
      {/* -------------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0e131b] border-0 lg:border border-[#1a2230] rounded-none lg:rounded-3xl overflow-hidden shadow-2xl relative">
        {/* Top App Header */}
        <header className="h-16 flex-shrink-0 bg-[#0e131b] border-b border-[#1a2230] px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 z-20">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {/* Active Page Header with Breadcrumb */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shrink-0">
                <currentItem.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-[#64748b] font-medium leading-none">
                  <span>Portal</span>
                  <span>/</span>
                  <span className="text-[#94a3b8] truncate">{admin.role === 'SUPERADMIN' ? 'Superadmin' : 'Coordinator'}</span>
                </div>
                <h2 className="text-sm sm:text-base font-bold font-display text-white tracking-tight leading-none mt-1 truncate">
                  {currentItem.label}
                </h2>
              </div>
            </div>
          </div>

          {/* Right Header Area */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Search Input on Desktop */}
            <div className="relative hidden md:block w-60 xl:w-80">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-[#131923] border border-[#1a2230] rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all shadow-inner"
              />
            </div>

            {/* Mobile-Only Quick Access: Customer Mini App View */}
            {!isDesktop && (
              <button
                onClick={onSwitchToMiniApp}
                className="lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#131923] border border-[#1a2230] text-[#94a3b8] hover:text-white text-[11px] font-semibold transition-all active:scale-95"
                title="Customer Mini App View"
                aria-label="Customer View"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#00d26a]" />
                <span className="hidden sm:inline">Mini App</span>
              </button>
            )}

            {/* Mobile-Only Quick Access: Logout */}
            {!isDesktop && (
              <button
                onClick={() => void handleLogout()}
                className="lg:hidden flex items-center p-2 rounded-xl bg-[#131923] border border-[#1a2230] text-[#94a3b8] hover:text-rose-400 hover:bg-rose-500/10 transition-colors active:scale-95"
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="w-4 h-4 text-[#94a3b8] transform -rotate-180" />
              </button>
            )}

            {/* Live Indicator on Desktop */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0c251b] border border-[#123c2a] text-[11px] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00d26a] animate-pulse"></span>
              <span className="font-semibold text-[#00d26a]">Live</span>
            </div>

            {/* User Avatar Initials */}
            <div
              className="w-8 h-8 rounded-full bg-[#0c251b] border border-[#123c2a] text-[#00d26a] font-black text-xs flex items-center justify-center shadow-md shadow-[#00d26a]/15"
              title={admin.email}
            >
              {admin.email.substring(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Scrollable View Content with bottom padding so bottom nav doesn't cover anything */}
        <main className="flex-1 overflow-y-auto p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-8 transition-colors no-scrollbar">
          <div className="max-w-7xl mx-auto space-y-6">
            <AdminErrorBoundary fallbackViewName={currentItem.label}>
              {activeTab === 'overview' && (
                <AdminOverviewView onNavigateTab={(tab) => handleSelectTab(tab as AdminTab)} />
              )}
              {activeTab === 'campaigns' && (
                <CampaignsView onInspectInventory={handleInspectInventory} />
              )}
              {activeTab === 'refunds' && <RefundsView />}
              {activeTab === 'inventory' && (
                <InventoryView
                  initialLotteryId={inspectLotteryId}
                  initialLotteryTitle={inspectLotteryTitle}
                />
              )}
              {activeTab === 'reviews' && <PaymentReviewsView />}
              {(activeTab === 'customers' || activeTab === 'reservations') && (
                <div className="space-y-4">
                  {/* Segmented Sub-Tab Switcher to toggle between Customers Directory and Reservations Ledger */}
                  <div className="flex items-center gap-1.5 p-1 bg-[#131923] border border-[#1a2230] rounded-2xl w-full sm:w-fit">
                    <button
                      type="button"
                      aria-label="Player Directory"
                      onClick={() => {
                        setActiveTab('customers');
                        triggerHaptic('selection');
                      }}
                      className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        activeTab === 'customers'
                          ? 'bg-[#00d26a] text-black shadow-md shadow-[#00d26a]/20'
                          : 'text-[#94a3b8] hover:text-white hover:bg-[#1a2230]'
                      }`}
                    >
                      <Users className="w-4 h-4 shrink-0" />
                      <span>Player Directory</span>
                    </button>

                    <button
                      type="button"
                      aria-label="Ticket Ledger"
                      onClick={() => {
                        setActiveTab('reservations');
                        triggerHaptic('selection');
                      }}
                      className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        activeTab === 'reservations'
                          ? 'bg-[#00d26a] text-black shadow-md shadow-[#00d26a]/20'
                          : 'text-[#94a3b8] hover:text-white hover:bg-[#1a2230]'
                      }`}
                    >
                      <Ticket className="w-4 h-4 shrink-0" />
                      <span>Ticket Ledger</span>
                    </button>
                  </div>

                  {activeTab === 'customers' ? <CustomersView /> : <ReservationsView />}
                </div>
              )}
              {activeTab === 'settings' && <SettingsView currentAdmin={admin} />}
            </AdminErrorBoundary>
          </div>
        </main>

        {/* -------------------------------------------------------------------------- */}
        {/* Mobile / Telegram Mini App Bottom Menubar                                  */}
        {/* Adjusted order: Reviews next to Campaigns, combined Customers & Reservations*/}
        {/* Clean icon without circle halo on click or active                           */}
        {/* -------------------------------------------------------------------------- */}
        {!isDesktop && (
          <nav
            role="navigation"
            aria-label="Admin Mobile Navigation"
            className="fixed bottom-0 left-0 right-0 z-40 bg-[#0e131b]/95 backdrop-blur-xl border-t border-[#1a2230] pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] pt-1 px-1 lg:hidden shadow-[0_-4px_24px_rgba(0,0,0,0.6)] select-none"
          >
            <div className="grid grid-cols-6 max-w-lg mx-auto items-center">
              {mobileNavItemsWithBadges.map(({ id, label, shortLabel, icon: Icon, badge }) => {
                const isActive = (id === 'customers' && (activeTab === 'customers' || activeTab === 'reservations')) || activeTab === id;
                return (
                  <button
                    key={`mobile-${id}`}
                    type="button"
                    onClick={() => handleSelectTab(id)}
                    aria-label={label}
                    aria-current={isActive ? 'page' : undefined}
                    className="flex flex-col items-center justify-center py-1 px-0.5 group active:scale-95 transition-all focus:outline-none outline-none select-none [-webkit-tap-highlight-color:transparent]"
                  >
                    {/* Top Indicator Pill Bar (centered emerald pill matching reference image) */}
                    <div
                      className={`w-7 h-1 rounded-full mb-1 transition-all duration-300 ${
                        isActive
                          ? 'bg-[#00d26a] shadow-[0_2px_8px_rgba(0,210,106,0.7)]'
                          : 'bg-transparent'
                      }`}
                    />

                    {/* Icon container - clean, without circular background */}
                    <div
                      className={`relative w-8 h-8 flex items-center justify-center transition-colors duration-200 ${
                        isActive
                          ? 'text-[#00d26a]'
                          : 'text-[#64748b] group-hover:text-[#94a3b8]'
                      }`}
                    >
                      <Icon className="w-5 h-5" />

                      {/* Notification Badge on top right of icon */}
                      {badge && (
                        <span
                          className={`absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-[8.5px] font-black flex items-center justify-center border shadow-sm leading-none ${
                            id === 'reviews'
                              ? 'bg-amber-500 text-black border-amber-300 animate-pulse'
                              : 'bg-[#00d26a] text-black border-[#00d26a]'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </div>

                    {/* Label below icon */}
                    <span
                      className={`text-[9.5px] tracking-tight truncate max-w-full leading-tight mt-0.5 transition-colors ${
                        isActive ? 'font-bold text-[#00d26a]' : 'font-medium text-[#64748b]'
                      }`}
                    >
                      {shortLabel || label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
};
