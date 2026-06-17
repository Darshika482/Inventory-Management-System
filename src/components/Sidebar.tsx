import React from 'react';
import { LogOut, Shield, User as UserIcon, Package, FileClock, Warehouse, X } from 'lucide-react';
import { User } from '../types';

interface SidebarProps {
  currentUser: User;
  onLogout: () => void;
  activeSection: string;
  setActiveSection: (sec: string) => void;
  userRole: 'Admin' | 'Worker';
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
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
  const handleNavClick = (section: string) => {
    setActiveSection(section);
    onMobileClose?.();
  };

  const handleLogout = () => {
    onMobileClose?.();
    onLogout();
  };

  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-50 w-72 bg-[#0F172A] text-slate-300 flex flex-col border-r border-slate-800 shrink-0 transform transition-transform duration-300 ease-in-out ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
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
          className="md:hidden p-2 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="px-6 py-5 border-b border-white/5 bg-[#0B0F19]/40 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 bg-slate-800 rounded-full border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
            {currentUser.role === 'Admin' ? (
              <Shield className="h-5 w-5 text-amber-500" />
            ) : (
              <UserIcon className="h-5 w-5 text-slate-400" />
            )}
          </div>
          <div className="overflow-hidden">
            <h3 className="text-base font-semibold text-white truncate" title={currentUser.username}>
              {currentUser.username}
            </h3>
            <span className={`inline-block mt-1 py-1 px-2 text-xs rounded-md font-semibold border ${
              currentUser.role === 'Admin'
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/20'
                : 'bg-blue-500/15 text-blue-400 border-blue-500/20'
            }`}>
              {currentUser.role === 'Worker' ? 'Staff' : 'Manager'}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        <p className="text-sm font-semibold text-slate-500 px-6 mb-3">
          Menu
        </p>

        {userRole === 'Admin' ? (
          <>
            <button
              onClick={() => handleNavClick('overview')}
              className={`w-full flex items-center gap-3 px-6 py-4 text-base transition-colors cursor-pointer text-left ${
                activeSection === 'overview'
                  ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
              }`}
            >
              <Package className="h-5 w-5 shrink-0" />
              All stock
            </button>
            <button
              onClick={() => handleNavClick('logs')}
              className={`w-full flex items-center gap-3 px-6 py-4 text-base transition-colors cursor-pointer text-left ${
                activeSection === 'logs'
                  ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
              }`}
            >
              <FileClock className="h-5 w-5 shrink-0" />
              Taken items
            </button>
          </>
        ) : (
          <button
            onClick={() => handleNavClick('withdraw')}
            className={`w-full flex items-center gap-3 px-6 py-4 text-base transition-colors cursor-pointer text-left ${
              activeSection === 'withdraw'
                ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
            }`}
          >
            <Package className="h-5 w-5 shrink-0" />
            Take stock
          </button>
        )}
      </nav>

      <div className="p-6">
        <div className="bg-[#1E293B] rounded-xl p-4 mb-4">
          <div className="text-sm text-slate-400 mb-1">Signed in as</div>
          <div className="text-base text-white font-semibold truncate">{currentUser.username}</div>
          <div className="text-sm text-emerald-400 mt-2 flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Connected
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-semibold text-slate-300 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer text-left"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
