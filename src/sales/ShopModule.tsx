/**
 * Where the shop sales module plugs into the app: its sidebar menu group and
 * its pages. App.tsx and Sidebar.tsx only call these two components.
 */
import React, { useEffect } from 'react';
import { AlertTriangle, CloudOff, Package, ReceiptText, Settings, ShoppingCart, Users } from 'lucide-react';
import type { User } from '../types';
import { useT, type TranslationKey } from './i18n';
import { startOutboxSync, useOutboxCounts } from './outbox';
import { installKeyboardDone } from './keyboard';
import { NewSaleSection } from './components/NewSaleSection';
import { ShopItemsSection } from './components/ShopItemsSection';
import { SalesListSection } from './components/SalesListSection';
import { ShopPartiesSection } from './components/ShopPartiesSection';
import { ShopSettingsSection } from './components/ShopSettingsSection';

export type ShopSectionId = 'shop-new-sale' | 'shop-sales' | 'shop-items' | 'shop-parties' | 'shop-settings';

interface ShopPage {
  id: ShopSectionId;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly: boolean;
}

const PAGES: ShopPage[] = [
  { id: 'shop-new-sale', labelKey: 'menuNewSale', icon: ShoppingCart, ownerOnly: false },
  { id: 'shop-sales', labelKey: 'menuSales', icon: ReceiptText, ownerOnly: false },
  { id: 'shop-items', labelKey: 'menuItems', icon: Package, ownerOnly: true },
  { id: 'shop-parties', labelKey: 'menuParties', icon: Users, ownerOnly: false },
  { id: 'shop-settings', labelKey: 'menuSettings', icon: Settings, ownerOnly: true },
];

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
  // Uploads bills saved on this phone, from whichever page is open.
  useEffect(() => startOutboxSync(), []);
  // Number keyboards: the ✓ / Done key closes the keyboard.
  useEffect(() => installKeyboardDone(), []);
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
      <SyncNotice onOpen={() => onNavigate('shop-sales')} />
    </>
  );
}

/** "3 bills waiting to upload" under the menu group; hidden when nothing waits. */
function SyncNotice({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  const { pending, failed } = useOutboxCounts();
  if (pending === 0 && failed === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mx-4 mt-2 w-[calc(100%-2rem)] min-h-12 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold cursor-pointer ${
        failed > 0 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'
      }`}
    >
      {failed > 0 ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CloudOff className="h-5 w-5 shrink-0" />}
      <span>{failed > 0 ? t('syncFailed', { n: failed }) : t('syncWaiting', { n: pending })}</span>
    </button>
  );
}

/** Big "New sale" button for the phone header, so billing is one tap away. */
export function NewSaleShortcut({ activeSection, onNavigate }: { activeSection: string; onNavigate: (section: string) => void }) {
  const { t } = useT();
  if (activeSection === 'shop-new-sale') return null;
  return (
    <button
      type="button"
      onClick={() => onNavigate('shop-new-sale')}
      className="ml-auto shrink-0 min-h-12 flex items-center gap-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0F172A] text-sm font-bold cursor-pointer"
    >
      <ShoppingCart className="h-5 w-5" />
      {t('menuNewSale')}
    </button>
  );
}

interface ShopSectionProps {
  section: ShopSectionId;
  currentUser: User;
  onNavigate: (section: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ShopSection({ section, currentUser, onNavigate, showToast }: ShopSectionProps) {
  switch (section) {
    case 'shop-new-sale':
      return <NewSaleSection currentUser={currentUser} onNavigate={onNavigate} showToast={showToast} />;
    case 'shop-sales':
      return <SalesListSection currentUser={currentUser} showToast={showToast} />;
    case 'shop-items':
      return <ShopItemsSection currentUser={currentUser} showToast={showToast} />;
    case 'shop-parties':
      return <ShopPartiesSection currentUser={currentUser} showToast={showToast} />;
    case 'shop-settings':
      return <ShopSettingsSection currentUser={currentUser} showToast={showToast} />;
  }
}
