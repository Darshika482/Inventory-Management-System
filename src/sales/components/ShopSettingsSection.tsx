import React, { useEffect, useState } from 'react';
import { Hash, MapPin, Printer, Save, Settings, ShieldAlert } from 'lucide-react';
import type { User } from '../../types';
import { FormError, FormInput } from '../../components/FormInput';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { fetchShopSettings, updateShopSettings } from '../db';
import { writeCache } from '../cache';
import { applyDefaultLanguage, useT } from '../i18n';
import { getDeviceSeries, setDeviceSeries } from '../outbox';
import { GST_STATES, isValidGstin, stateFromGstin } from '../states';
import { formatBillNumber, fyFor, istToday } from '../fy';
import type { ShopSettings } from '../types';
import { PrinterSetupPanel } from './PrintUi';
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
      applyDefaultLanguage(settings.language);
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
              value={settings.phone}
              onChange={(e) => update('phone', e.target.value)}
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
            <FormInput
              label={`${t('upiId')} ${t('optional')}`}
              value={settings.upiId}
              onChange={(e) => update('upiId', e.target.value.trim())}
              placeholder="akshaytraders@upi"
              autoCapitalize="none"
            />
          </div>
          <ToggleRow
            label={t('ratesIncludeGst')}
            hint={t('ratesIncludeGstHint')}
            checked={settings.ratesIncludeGst}
            onChange={(checked) => update('ratesIncludeGst', checked)}
          />
          <FormInput
            label={t('receiptFooter')}
            value={settings.receiptFooter}
            onChange={(e) => update('receiptFooter', e.target.value)}
          />
        </section>

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
