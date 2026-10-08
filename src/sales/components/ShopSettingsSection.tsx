import React, { useEffect, useState } from 'react';
import { CheckCircle2, Hash, MapPin, Plus, Printer, QrCode, Save, Settings, ShieldAlert, Trash2, X } from 'lucide-react';
import type { User } from '../../types';
import { FormError, FormInput } from '../../components/FormInput';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { fetchShopSettings, updateShopSettings } from '../db';
import { writeCache } from '../cache';
import { useT } from '../i18n';
import { getDeviceSeries, setDeviceSeries } from '../outbox';
import { GST_STATES, isValidGstin, stateFromGstin, toShopPhones } from '../states';
import { formatBillNumber, fyFor, istToday } from '../fy';
import { newId } from '../ids';
import { upiLink, upiPayee } from '../print/receipt';
import type { ShopSettings, UpiAccount } from '../types';
import { PrinterSetupPanel, QrSvg } from './PrintUi';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  PickerField,
  Segmented,
  ToggleRow,
} from './ui';

interface ShopSettingsSectionProps {
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const SERIES_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** name@bank */
const UPI_ID = /^[\w.\-]+@[\w.\-]+$/;

type UpdateSetting = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => void;

export function ShopSettingsSection({ currentUser, showToast }: ShopSettingsSectionProps) {
  const { t } = useT();
  const isOwner = currentUser.role === 'Admin';
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [series, setSeries] = useState(getDeviceSeries);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setSettings(await fetchShopSettings());
    } catch (err) {
      setLoadError(describeDbError(err, 'Shop settings could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!isOwner) {
    return (
      <PageShell>
        <PageHeader title={t('settingsTitle')} icon={<Settings className="h-5 w-5" />} />
        <EmptyState icon={<ShieldAlert className="h-10 w-10" />} title={t('ownerOnlySettings')} />
      </PageShell>
    );
  }
  if (isLoading) return <LoadingState />;
  if (loadError || !settings) {
    return <ErrorState error={loadError ?? { message: t('loadFailed'), detail: '' }} onRetry={load} />;
  }

  const update = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleGstinChange = (value: string) => {
    const gstin = value.toUpperCase().replace(/\s/g, '');
    const fromGstin = isValidGstin(gstin) ? stateFromGstin(gstin) : null;
    setSettings((prev) => (prev ? { ...prev, gstin, stateCode: fromGstin ?? prev.stateCode } : prev));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!settings.shopName.trim()) {
      setProblem({ message: t('shopNameRequired'), detail: '' });
      return;
    }
    if (settings.gstin.trim() && !isValidGstin(settings.gstin)) {
      setProblem({ message: t('gstinInvalid'), detail: '' });
      return;
    }

    setIsSaving(true);
    try {
      await updateShopSettings(settings, currentUser.id);
      setDeviceSeries(series);
      writeCache('settings', settings);
      showToast(t('settingsSaved'), 'success');
    } catch (err) {
      setProblem(describeDbError(err, t('settingsSaveFailed')));
    } finally {
      setIsSaving(false);
    }
  };

  const exampleNumber = formatBillNumber('sale', series, fyFor(istToday()), 1);

  return (
    <PageShell>
      <PageHeader title={t('settingsTitle')} icon={<Settings className="h-5 w-5" />} />

      <form onSubmit={handleSave} className="max-w-2xl space-y-5">
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
          <p className="text-sm text-slate-500">{t('settingsHint')}</p>
          <FormInput
            label={t('shopName')}
            value={settings.shopName}
            onChange={(e) => update('shopName', e.target.value)}
            required
          />
          <FormInput
            label={t('address')}
            value={settings.address}
            onChange={(e) => update('address', e.target.value)}
          />
          <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
            <FormInput
              label={t('phone')}
              type="tel"
              inputMode="tel"
              maxLength={23}
              placeholder="9131297397, 9300106271"
              value={settings.phone}
              onChange={(e) => update('phone', toShopPhones(e.target.value))}
            />
            <FormInput
              label={`${t('gstin')} ${t('optional')}`}
              value={settings.gstin}
              onChange={(e) => handleGstinChange(e.target.value)}
              maxLength={15}
              autoCapitalize="characters"
            />
          </div>
          <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
            <PickerField
              label={t('state')}
              title={t('state')}
              icon={<MapPin className="h-5 w-5" />}
              value={settings.stateCode}
              options={GST_STATES.map((s) => ({ value: s.code, label: s.name, description: s.code }))}
              onChange={(value) => update('stateCode', value)}
              searchable
            />
          </div>
          <ToggleRow
            label={t('ratesIncludeGst')}
            hint={t('ratesIncludeGstHint')}
            checked={settings.ratesIncludeGst}
            onChange={(checked) => update('ratesIncludeGst', checked)}
          />
        </section>

        <UpiAccountsSection settings={settings} update={update} />

        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
          <Segmented
            label={t('printerWidth')}
            value={settings.printerWidthMm}
            options={[
              { value: 58, label: '58 mm', icon: <Printer className="h-4 w-4" /> },
              { value: 80, label: '80 mm', icon: <Printer className="h-4 w-4" /> },
            ]}
            onChange={(value) => update('printerWidthMm', value)}
          />
          <Segmented
            label={t('defaultLanguage')}
            value={settings.language}
            options={[
              { value: 'hi', label: 'हिंदी' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value) => update('language', value)}
          />
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-2">
          <PickerField
            label={t('deviceSeries')}
            title={t('deviceSeries')}
            icon={<Hash className="h-5 w-5" />}
            value={series}
            options={SERIES_LETTERS.map((letter) => ({ value: letter, label: letter }))}
            onChange={setSeries}
          />
          <p className="text-sm text-slate-500 leading-relaxed">
            {t('deviceSeriesHint', { example: exampleNumber })}
          </p>
        </section>

        {problem && <FormError message={problem.message} detail={problem.detail} />}

        <ActionButton
          type="submit"
          icon={<Save className="h-5 w-5" />}
          label={isSaving ? t('saving') : t('save')}
          busy={isSaving}
          size="lg"
          className="w-full @xl:w-auto"
        />
      </form>

      {/* Printer choices are per phone and save as soon as they change. */}
      <section className="max-w-2xl bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Printer className="h-5 w-5 text-amber-600" />
          {t('printerTitle')}
        </h2>
        <PrinterSetupPanel settings={settings} />
      </section>
    </PageShell>
  );
}

/**
 * The UPI accounts the shop is paid into, and which one's QR goes on bills.
 * Saved with the page's Save button, like the rest of the shop details.
 */
function UpiAccountsSection({ settings, update }: { settings: ShopSettings; update: UpdateSetting }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [newUpiId, setNewUpiId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const accounts = settings.upiAccounts;

  // The database cannot keep a list yet: the single UPI ID, as before.
  if (!accounts) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-2">
        <FormInput
          label={`${t('upiId')} ${t('optional')}`}
          value={settings.upiId}
          onChange={(e) => update('upiId', e.target.value.trim())}
          placeholder="akshaytraders@upi"
          autoCapitalize="none"
        />
        <p className="text-sm text-slate-500">{t('upiSqlMissing')}</p>
      </section>
    );
  }

  const selected = settings.upiId.trim().toLowerCase();
  const payee = upiPayee(settings);

  const closeForm = () => {
    setAdding(false);
    setLabel('');
    setNewUpiId('');
    setError(null);
  };

  const add = () => {
    const upiId = newUpiId.trim();
    if (!UPI_ID.test(upiId)) return setError(t('upiInvalid'));
    if (accounts.some((a) => a.upiId.toLowerCase() === upiId.toLowerCase())) return setError(t('upiDuplicate'));
    const account: UpiAccount = { id: newId(), label: label.trim() || upiId, upiId, payeeName: '', merchantCode: '' };
    update('upiAccounts', [...accounts, account]);
    if (!settings.upiId.trim()) update('upiId', upiId);
    closeForm();
  };

  // Enter in these boxes adds the account; it must not save the whole page.
  const addOnEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3" data-testid="upi-accounts">
      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <QrCode className="h-5 w-5 text-amber-600" />
        {t('upiOnBills')}
      </h2>
      <p className="text-sm text-slate-500">{t('upiOnBillsHint')}</p>

      <div role="radiogroup" aria-label={t('upiOnBills')} className="space-y-2">
        {accounts.map((account) => {
          const on = account.upiId.toLowerCase() === selected;
          return (
            <div
              key={account.id}
              className={`flex items-center gap-1 rounded-xl border transition-colors ${
                on ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update('upiId', account.upiId)}
                className="min-w-0 flex-1 flex items-center gap-3 px-3 py-3 text-left cursor-pointer"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {on && <CheckCircle2 className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold text-slate-900">{account.label}</span>
                  <span className="block text-sm text-slate-500 break-words">
                    {account.upiId}
                    {account.payeeName && ` · ${account.payeeName}`}
                  </span>
                </span>
              </button>
              {on ? (
                <span className="shrink-0 mr-3 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
                  {t('upiInUse')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => update('upiAccounts', accounts.filter((a) => a.id !== account.id))}
                  aria-label={`${t('upiRemove')} ${account.label}`}
                  title={t('upiRemove')}
                  className="h-11 w-11 shrink-0 mr-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {payee && (
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="shrink-0 rounded-lg bg-white p-1.5 border border-slate-200">
            <QrSvg data={upiLink(payee.upiId, payee.name, null, payee.merchantCode)} className="h-28 w-28" />
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{t('upiScanCheck')}</p>
        </div>
      )}

      {adding ? (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <FormInput
            label={`${t('upiLabel')} ${t('optional')}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={addOnEnter}
            placeholder="PhonePe, PNB..."
          />
          <FormInput
            label={t('upiIdField')}
            value={newUpiId}
            onChange={(e) => {
              setNewUpiId(e.target.value.trim());
              setError(null);
            }}
            onKeyDown={addOnEnter}
            placeholder="name@bank"
            autoCapitalize="none"
          />
          {error && <FormError message={error} />}
          <div className="grid grid-cols-2 gap-2">
            <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={closeForm} />
            <ActionButton icon={<Plus className="h-5 w-5" />} label={t('upiAddButton')} onClick={add} />
          </div>
        </div>
      ) : (
        <ActionButton tone="secondary" icon={<Plus className="h-5 w-5" />} label={t('upiAdd')} onClick={() => setAdding(true)} className="w-full" />
      )}
      <p className="text-xs text-slate-500">{t('upiSaveHint')}</p>
    </section>
  );
}
