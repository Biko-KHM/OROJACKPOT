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
  Menu,
  X,
  Search,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { AdminUser } from '../../types/index.js';
import { api } from '../../api/client.js';
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
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', icon: Layers },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'reviews', label: 'Payment Reviews', icon: CheckSquare },
  { id: 'reservations', label: 'Reservations', icon: Ticket },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pendingReviewsCount, setPendingReviewsCount] = useState<number | null>(null);

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
    setIsMobileMenuOpen(false);
  };

  const handleSelectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
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

  const filteredNavItems = NAV_ITEMS.map((item) => {
    if (item.id === 'reviews' && pendingReviewsCount && pendingReviewsCount > 0) {
      return { ...item, badge: `${pendingReviewsCount}` };
    }
    if (item.id === 'settings' && admin.role !== 'SUPERADMIN') {
      return { ...item, badge: 'View' };
    }
    return item;
  }).filter((item) => {
    if (!searchQuery.trim()) return true;
    return item.label.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="h-screen w-full bg-[#080b10] text-slate-100 flex p-2 sm:p-3.5 gap-3 overflow-hidden font-sans selection:bg-[#00d26a]/30">
      {/* Mobile Backdrop Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* Sidebar (Styled in FulusApp obsidian & electric green theme)              */}
      {/* -------------------------------------------------------------------------- */}
      <aside
        className={`fixed lg:static inset-y-2 left-2 z-50 w-60 xl:w-64 bg-[#0e131b] border border-[#1a2230] rounded-3xl flex flex-col justify-between p-3 sm:p-3.5 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-[110%]'
        }`}
      >
        {/* Top: Logo & Brand */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2">
            <div className="flex items-center gap-2.5">
              {/* Luxury Logo Badge */}
              <div className="relative w-9 h-9 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-tr from-[#00d26a]/50 via-amber-400/30 to-[#00d26a]/40 shadow-md shadow-[#00d26a]/15 shrink-0">
                <img src="/logo.png" alt="OROJACKPOT" className="w-full h-full object-cover rounded-[12px]" />
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

            {/* Mobile Close Button */}
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden p-1 rounded-lg text-[#94a3b8] hover:text-white hover:bg-[#131923] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Divider line under brand */}
          <div className="h-px bg-[#1a2230] mx-1 mb-2" />

          {/* Navigation Items (Compact, sleek buttons fitting comfortably without scrollbar) */}
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
                    key={id}
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

        {/* Bottom Section: Profile & Clean [← Logout Button */}
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

          {/* Minimalist [← Logout Button */}
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

      {/* -------------------------------------------------------------------------- */}
      {/* Main Content Card (Rounded-3xl panel in FulusApp styling)                  */}
      {/* -------------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0e131b] border border-[#1a2230] rounded-3xl overflow-hidden shadow-2xl">
        {/* Top App Header with Search & Active Breadcrumbs */}
        <header className="h-16 flex-shrink-0 bg-[#0e131b] border-b border-[#1a2230] px-4 sm:px-8 flex items-center justify-between gap-4 z-20">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-[#94a3b8] hover:text-white hover:bg-[#131923] transition-colors"
              aria-label="Open Sidebar Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Active Page Header with Breadcrumb */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shrink-0">
                <currentItem.icon className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[10.5px] text-[#64748b] font-medium leading-none">
                  <span>Portal</span>
                  <span>/</span>
                  <span className="text-[#94a3b8]">{admin.role === 'SUPERADMIN' ? 'Superadmin' : 'Coordinator'}</span>
                </div>
                <h2 className="text-sm sm:text-base font-bold font-display text-white tracking-tight leading-none mt-1">
                  {currentItem.label}
                </h2>
              </div>
            </div>
          </div>

          {/* Right Header Area: Search Bar */}
          <div className="flex items-center gap-3">
            {/* Modern Search Pill Input */}
            <div className="relative hidden md:block w-64 xl:w-80">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-[#131923] border border-[#1a2230] rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#00d26a] focus:ring-1 focus:ring-[#00d26a] transition-all shadow-inner"
              />
            </div>

            {/* System Status Pill */}
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

        {/* Scrollable View Content with unseen / invisible scrollbar */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 transition-colors no-scrollbar">
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
              {activeTab === 'reservations' && <ReservationsView />}
              {activeTab === 'customers' && <CustomersView />}
              {activeTab === 'settings' && <SettingsView currentAdmin={admin} />}
            </AdminErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
};
