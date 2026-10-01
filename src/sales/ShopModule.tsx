/**
 * Where the shop sales module plugs into the app: its sidebar menu group and
 * its pages. App.tsx and Sidebar.tsx only call these two components.
 */
import React from 'react';
import { Settings } from 'lucide-react';
import type { User } from '../types';
import { useT, type TranslationKey } from './i18n';
import { ShopSettingsSection } from './components/ShopSettingsSection';

export type ShopSectionId = 'shop-settings';

interface ShopPage {
  id: ShopSectionId;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly: boolean;
}

const PAGES: ShopPage[] = [{ id: 'shop-settings', labelKey: 'menuSettings', icon: Settings, ownerOnly: true }];

function pagesFor(role: User['role']): ShopPage[] {
  return PAGES.filter((page) => role === 'Admin' || !page.ownerOnly);
}

/** True for any page of this module that the person is allowed to open. */
export function isShopSection(section: string, role: User['role']): section is ShopSectionId {
  return pagesFor(role).some((page) => page.id === section);
}

interface ShopNavGroupProps {
  role: User['role'];
  activeSection: string;
  onNavigate: (section: string) => void;
}

/** The "Shop sales" group in the sidebar menu, styled like the other menu buttons. */
export function ShopNavGroup({ role, activeSection, onNavigate }: ShopNavGroupProps) {
  const { t } = useT();
  return (
    <>
      <p className="text-sm font-semibold text-slate-500 px-6 pt-5 mb-3">{t('menuGroup')}</p>
      {pagesFor(role).map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          className={`w-full flex items-center gap-3 px-6 py-4 text-base transition-colors cursor-pointer text-left ${
            activeSection === id
              ? 'bg-white/5 text-white border-l-4 border-amber-500 font-semibold'
              : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-4 border-transparent'
          }`}
        >
          <Icon className="h-5 w-5 shrink-0" />
          {t(labelKey)}
        </button>
      ))}
    </>
  );
}

interface ShopSectionProps {
  section: ShopSectionId;
  currentUser: User;
  onNavigate: (section: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ShopSection({ section, currentUser, showToast }: ShopSectionProps) {
  switch (section) {
    case 'shop-settings':
      return <ShopSettingsSection currentUser={currentUser} showToast={showToast} />;
  }
}
