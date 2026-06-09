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
      className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#0F172A] text-slate-300 flex flex-col border-r border-slate-800 shrink-0 transform transition-transform duration-300 ease-in-out ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      {/* Brand Header */}
      <div className="p-6 md:p-8 md:pb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center text-[#0F172A] font-bold shrink-0">
            <Warehouse className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="font-sans text-white font-bold tracking-tight text-base uppercase truncate">
              STK_MASTER
            </h1>
            <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
              IMS V1.0
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onMobileClose}
          className="md:hidden p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
          aria-label="Close navigation menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* User Information Profile */}
      <div className="px-6 py-4 border-b border-white/5 bg-[#0B0F19]/40 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-slate-800 rounded-full border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
            {currentUser.role === 'Admin' ? (
              <Shield className="h-4 w-4 text-amber-500" />
            ) : (
              <UserIcon className="h-4 w-4 text-slate-400" />
            )}
          </div>
          <div className="overflow-hidden">
            <h3 className="font-sans text-xs font-semibold text-white truncate" title={currentUser.username}>
              {currentUser.username}
            </h3>
            <span className={`inline-block py-0.5 px-1.5 text-[8px] font-mono rounded font-semibold border uppercase tracking-wider ${
              currentUser.role === 'Admin'
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/20'
                : 'bg-blue-500/15 text-blue-400 border-blue-500/20'
            }`}>
              {currentUser.role}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="flex-1 space-y-1 overflow-y-auto">
        <p className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-500 px-6 mb-3">
          Management Controls
        </p>

        {userRole === 'Admin' ? (
          <>
            <button
              onClick={() => handleNavClick('overview')}
              className={`w-full flex items-center gap-3 px-6 py-3 font-sans text-sm transition-colors cursor-pointer text-left ${
                activeSection === 'overview'
                  ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                  : 'text-slate-450 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
              }`}
            >
              <Package className="h-4 w-4 shrink-0" />
              Stock Overview
            </button>
            <button
              onClick={() => handleNavClick('logs')}
              className={`w-full flex items-center gap-3 px-6 py-3 font-sans text-sm transition-colors cursor-pointer text-left ${
                activeSection === 'logs'
                  ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                  : 'text-slate-450 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
              }`}
            >
              <FileClock className="h-4 w-4 shrink-0" />
              Withdrawal Logs
            </button>
          </>
        ) : (
          <button
            onClick={() => handleNavClick('withdraw')}
            className={`w-full flex items-center gap-3 px-6 py-3 font-sans text-sm transition-colors cursor-pointer text-left ${
              activeSection === 'withdraw'
                ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
                : 'text-slate-450 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
            }`}
          >
            <Package className="h-4 w-4 shrink-0" />
            Request Withdrawal
          </button>
        )}
      </nav>

      {/* Sidebar Footer with Logout Button */}
      <div className="p-6">
        <div className="bg-[#1E293B] rounded-lg p-4 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 font-semibold">Active Session</div>
          <div className="text-sm text-white font-medium truncate">{currentUser.username}</div>
          <div className="text-[11px] text-amber-500 mt-1 flex items-center gap-1.5 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            System Online
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer text-left"
        >
          <LogOut className="h-4 w-4 text-slate-500 hover:text-red-400" />
          Terminate Session
        </button>
      </div>
    </aside>
  );
}
