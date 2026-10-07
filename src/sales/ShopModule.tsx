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
import { lazyPage, preloadInBackground } from '../lib/lazyPage';
import { PageFrame } from '../components/PageFrame';

// Each page's code is downloaded when it is first opened (and in the
// background once the app is idle), not all at once when the app starts.
const NewSaleSection = lazyPage(() => import('./components/NewSaleSection'), (m) => m.NewSaleSection);
const SalesListSection = lazyPage(() => import('./components/SalesListSection'), (m) => m.SalesListSection);
const ShopItemsSection = lazyPage(() => import('./components/ShopItemsSection'), (m) => m.ShopItemsSection);
const ShopPartiesSection = lazyPage(() => import('./components/ShopPartiesSection'), (m) => m.ShopPartiesSection);
const ShopSettingsSection = lazyPage(() => import('./components/ShopSettingsSection'), (m) => m.ShopSettingsSection);
const PrinterHelpHost = lazyPage(() => import('./components/PrintUi'), (m) => m.PrinterHelpHost);

const PAGE_CODE: Record<ShopSectionId, { preload: () => Promise<unknown> }> = {
  'shop-new-sale': NewSaleSection,
  'shop-sales': SalesListSection,
  'shop-items': ShopItemsSection,
  'shop-parties': ShopPartiesSection,
  'shop-settings': ShopSettingsSection,
};

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

/** Downloads the code of every shop page this person can open, while the phone is idle. */
export function preloadShopPages(role: User['role']): void {
  preloadInBackground([
    PAGE_CODE['shop-new-sale'],
    PrinterHelpHost,
    ...pagesFor(role).map((page) => PAGE_CODE[page.id]),
  ]);
}

/** True for any page of this module that the person is allowed to open. */
export function isShopSection(section: string, role: User['role']): section is ShopSectionId {
  return pagesFor(role).some((page) => page.id === section);
}

interface ShopNavGroupProps {
  role: User['role'];
  activeSection: string;
  onNavigate: (section: string) => void;
  /** False when a sidebar tab already names the group. */
  showHeading?: boolean;
  /** False while another sidebar tab is open. The group stays mounted so bills keep uploading. */
  showPages?: boolean;
}

/** The "Shop sales" group in the sidebar menu, styled like the other menu buttons. */
export function ShopNavGroup({ role, activeSection, onNavigate, showHeading = true, showPages = true }: ShopNavGroupProps) {
  const { t } = useT();
  // Uploads bills saved on this phone, from whichever page is open.
  useEffect(() => startOutboxSync(), []);
  // Number keyboards: the ✓ / Done key closes the keyboard.
  useEffect(() => installKeyboardDone(), []);
  return (
    <>
      {showPages && showHeading && (
        <p className="text-sm font-semibold text-slate-500 px-6 pt-5 mb-3">{t('menuGroup')}</p>
      )}
      {showPages && pagesFor(role).map(({ id, labelKey, icon: Icon }) => (
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

/** "Shop sales" in the phone's chosen language, for the sidebar tab. */
export function ShopTabLabel() {
  const { t } = useT();
  return <>{t('menuGroup')}</>;
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

export function ShopSection(props: ShopSectionProps) {
  const { t } = useT();
  const labels = { title: t('loadFailed'), hint: t('needsInternet'), retry: t('tryAgain') };
  return (
    <>
      <PageFrame loadingLabel={t('loading')} labels={labels}>
        <ShopPage {...props} />
      </PageFrame>
      {/* Its own frame: a missing printer sheet must never hide the bill screen. */}
      <PageFrame quiet>
        <PrinterHelpHost canEdit={props.currentUser.role === 'Admin'} />
      </PageFrame>
    </>
  );
}

function ShopPage({ section, currentUser, onNavigate, showToast }: ShopSectionProps) {
  switch (section) {
    case 'shop-new-sale':
      return <NewSaleSection currentUser={currentUser} onNavigate={onNavigate} showToast={showToast} />;
    case 'shop-sales':
      return <SalesListSection currentUser={currentUser} onNavigate={onNavigate} showToast={showToast} />;
    case 'shop-items':
      return <ShopItemsSection currentUser={currentUser} showToast={showToast} />;
    case 'shop-parties':
      return <ShopPartiesSection currentUser={currentUser} showToast={showToast} />;
    case 'shop-settings':
      return <ShopSettingsSection currentUser={currentUser} showToast={showToast} />;
  }
}
