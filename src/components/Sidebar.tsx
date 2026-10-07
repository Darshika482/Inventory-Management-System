import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Package, FileClock, CalendarPlus, ReceiptText, Truck, Users, Wallet, Warehouse, BarChart3, Boxes, Store, X } from 'lucide-react';
import { User } from '../types';
import { isShopSection, ShopNavGroup, ShopTabLabel } from '../sales/ShopModule';

interface SidebarProps {
  currentUser: User;
  onLogout: () => void;
  activeSection: string;
  setActiveSection: (sec: string) => void;
  userRole: 'Admin' | 'Worker';
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

const STOCK_PAGES = [
  { id: 'overview', label: 'All stock', icon: Package },
  { id: 'logs', label: 'Taken items', icon: FileClock },
  { id: 'stock-added', label: 'Stock added', icon: CalendarPlus },
  { id: 'bills', label: 'Party bills', icon: ReceiptText },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'analysis', label: 'Rate analysis', icon: BarChart3 },
  { id: 'transport', label: 'Transport bills', icon: Truck },
  { id: 'workers', label: 'Workers', icon: Users },
];

type SidebarTab = 'stock' | 'shop';

const SIDEBAR_TAB_KEY = 'ims_sidebar_tab';

function tabFor(section: string): SidebarTab {
  return isShopSection(section, 'Admin') ? 'shop' : 'stock';
}

// Reopen on the tab the manager last had, even if they only switched tabs
// without opening a page. Falls back to the tab holding the open page.
function readInitialTab(activeSection: string): SidebarTab {
  const stored = localStorage.getItem(SIDEBAR_TAB_KEY);
  return stored === 'stock' || stored === 'shop' ? stored : tabFor(activeSection);
}

export function Sidebar({
  currentUser,
  onLogout,
  activeSection,
  setActiveSection,
  userRole,
  isMobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>(() => readInitialTab(activeSection));

  // A page opened from outside the menu (the phone's "New sale" button, the
  // waiting-bills notice) switches to its tab, so the open page is always shown.
  const lastSection = useRef(activeSection);
  useEffect(() => {
    if (lastSection.current === activeSection) return;
    lastSection.current = activeSection;
    setTab(tabFor(activeSection));
  }, [activeSection]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_TAB_KEY, tab);
  }, [tab]);

  const handleNavClick = (section: string) => {
    setActiveSection(section);
    onMobileClose?.();
  };

  const handleLogout = () => {
    onMobileClose?.();
    onLogout();
  };

  const isAdmin = userRole === 'Admin';
  const tabs = [
    { id: 'stock' as const, label: 'Stock', icon: Boxes },
    { id: 'shop' as const, label: <ShopTabLabel />, icon: Store },
  ];

  return (
    <aside
      className={`fixed docked:static inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0F172A] text-slate-300 flex flex-col border-r border-slate-800 shrink-0 transform transition-transform duration-300 ease-in-out ${
        isMobileOpen ? 'translate-x-0 shadow-2xl docked:shadow-none' : '-translate-x-full docked:translate-x-0'
      }`}
    >
      <div className="p-6 md:p-8 md:pb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 bg-amber-500 rounded-xl flex items-center justify-center text-[#0F172A] font-bold shrink-0">
            <Warehouse className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-bold tracking-tight text-lg truncate">
              Akshay Traders
            </h1>
            <p className="text-sm text-slate-400">
              Stock manager
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onMobileClose}
          className="docked:hidden p-2 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {isAdmin && (
        <div role="tablist" aria-label="Menu" className="mx-4 mb-4 grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#1E293B]">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`min-h-11 flex items-center justify-center gap-1.5 px-1 rounded-lg text-sm font-semibold leading-tight transition-colors cursor-pointer ${
                tab === id
                  ? 'bg-amber-500 text-[#0F172A]'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-center">{label}</span>
            </button>
          ))}
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
        {!isAdmin && (
          <p className="text-sm font-semibold text-slate-500 px-6 mb-3">
            Menu
          </p>
        )}

        {isAdmin && tab === 'stock' &&
          STOCK_PAGES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={`w-full flex items-center gap-3 px-6 py-4 text-base transition-colors cursor-pointer text-left ${
                activeSection === id
                  ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </button>
          ))}

        {/* Always mounted: it keeps saved bills uploading and shows the waiting-bills notice on both tabs. */}
        <ShopNavGroup
          role={userRole}
          activeSection={activeSection}
          onNavigate={handleNavClick}
          showHeading={!isAdmin}
          showPages={!isAdmin || tab === 'shop'}
        />
      </nav>

      <div className="p-4 border-t border-white/5">
        <div className="flex items-center justify-between gap-3 mb-2 rounded-lg bg-[#1E293B] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[0.7rem] text-slate-400 leading-tight">Signed in as</p>
            <p className="text-sm text-white font-semibold truncate leading-tight" title={currentUser.username}>
              {currentUser.username}{' '}
              <span className="font-normal text-slate-400">
                ({currentUser.role === 'Worker' ? 'Staff' : 'Manager'})
              </span>
            </p>
          </div>
          <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Connected
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer text-left"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
