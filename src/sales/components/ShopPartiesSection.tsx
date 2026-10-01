import React, { useEffect, useMemo, useState } from 'react';
import { Check, MapPin, Pencil, Phone, Plus, UserPlus, Users, X } from 'lucide-react';
import type { User } from '../../types';
import { AppModal } from '../../components/AppModal';
import { FormError, FormInput } from '../../components/FormInput';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { deleteShopParty, fetchShopParties, fetchShopSettings, insertShopParty, updateShopParty } from '../db';
import { loadWithCache } from '../cache';
import { useT } from '../i18n';
import { newId } from '../ids';
import { formatRupees, paiseToInput, parsePaise } from '../money';
import { GST_STATES, isValidGstin, stateFromGstin, stateName, toPhoneDigits } from '../states';
import type { PartyType, ShopParty, ShopSettings } from '../types';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  PickerField,
  DeleteZone,
  SearchBox,
  Segmented,
} from './ui';

interface ShopPartiesSectionProps {
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ShopPartiesSection({ currentUser, showToast }: ShopPartiesSectionProps) {
  const { t } = useT();
  const [parties, setParties] = useState<ShopParty[]>([]);
  const [shopState, setShopState] = useState('23');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ShopParty | 'new' | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [partyData, settings] = await Promise.all([
        fetchShopParties(),
        loadWithCache<ShopSettings>('settings', fetchShopSettings),
      ]);
      // Hidden customers (deleted but with old bills) are not listed.
      setParties(partyData.filter((p) => p.isActive));
      setShopState(settings.data.stateCode);
    } catch (err) {
      setLoadError(describeDbError(err, 'Customers could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parties;
    const digits = q.replace(/\D/g, '');
    return parties.filter(
      (p) => p.name.toLowerCase().includes(q) || (digits.length > 0 && p.phone.replace(/\D/g, '').includes(digits))
    );
  }, [parties, search]);

  if (isLoading) return <LoadingState />;
  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  const handleSaved = (party: ShopParty, isNew: boolean) => {
    setParties((prev) =>
      (isNew ? [...prev, party] : prev.map((p) => (p.id === party.id ? party : p))).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
    setEditing(null);
    showToast(t('partySaved', { name: party.name }), 'success');
  };

  return (
    <PageShell>
      <PageHeader
        title={t('partiesTitle')}
        icon={<Users className="h-5 w-5" />}
        actions={<ActionButton icon={<Plus className="h-5 w-5" />} label={t('addParty')} onClick={() => setEditing('new')} />}
      />

      <SearchBox value={search} onChange={setSearch} placeholder={t('searchParties')} />

      {parties.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={t('noParties')}
          hint={t('noPartiesHint')}
          action={<ActionButton icon={<Plus className="h-5 w-5" />} label={t('addParty')} onClick={() => setEditing('new')} />}
        />
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-base bg-white border border-slate-200 rounded-xl">
          {t('noMatch')}
        </div>
      ) : (
        <ul className="space-y-2 @3xl:grid @3xl:grid-cols-2 @3xl:gap-3 @3xl:space-y-0">
          {filtered.map((party) => (
            <li key={party.id}>
              <button
                type="button"
                onClick={() => setEditing(party)}
                className="w-full min-h-14 flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 text-left hover:border-amber-300 cursor-pointer transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold text-slate-900 truncate">{party.name}</p>
                  <p className="text-sm text-slate-500 truncate flex items-center gap-1.5">
                    {party.phone && (
                      <>
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {party.phone}
                      </>
                    )}
                    {party.stateCode !== shopState && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                        {t('otherStateNote')}
                      </span>
                    )}
                  </p>
                  {party.openingBalance !== 0 && (
                    <p
                      className={`text-sm font-semibold mt-0.5 ${
                        party.openingBalance > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {t('oldBalance', { amount: formatRupees(party.openingBalance) })}
                    </p>
                  )}
                </div>
                <span className="shrink-0 px-2.5 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-600">
                  {t(`type_${party.partyType}`)}
                </span>
                <Pencil className="h-4 w-4 text-slate-400 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PartyFormModal
        open={editing !== null}
        party={editing === 'new' ? null : editing}
        defaultStateCode={shopState}
        canEditBalance={currentUser.role === 'Admin'}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
        onDeleted={(deleted, result) => {
          setParties((prev) => prev.filter((p) => p.id !== deleted.id));
          setEditing(null);
          showToast(t(result === 'hidden' ? 'partyHidden' : 'partyDeleted', { name: deleted.name }), 'info');
        }}
      />
    </PageShell>
  );
}

// --- Add / change a customer ---

interface PartyFormModalProps {
  open: boolean;
  party: ShopParty | null;
  defaultStateCode: string;
  /** Only the owner sets the old balance. */
  canEditBalance: boolean;
  /** Quick add from the bill screen: just name and phone. */
  quick?: boolean;
  /** Pre-filled name, e.g. what was typed in the customer search. */
  initialName?: string;
  onClose: () => void;
  onSaved: (party: ShopParty, isNew: boolean) => void;
  /** Shown to the owner when changing a saved customer. */
  onDeleted?: (party: ShopParty, result: 'deleted' | 'hidden') => void;
}

function cleanPhone(phone: string): string {
  return phone.replace(/[\s-]/g, '').replace(/^\+91/, '');
}

export function PartyFormModal({
  open,
  party,
  defaultStateCode,
  canEditBalance,
  quick = false,
  initialName = '',
  onClose,
  onSaved,
  onDeleted,
}: PartyFormModalProps) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState(defaultStateCode);
  const [partyType, setPartyType] = useState<PartyType>('customer');
  const [openingBalance, setOpeningBalance] = useState('');
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(party?.name ?? initialName);
    setPhone(party?.phone ?? '');
    setAddress(party?.address ?? '');
    setGstin(party?.gstin ?? '');
    setStateCode(party?.stateCode ?? defaultStateCode);
    setPartyType(party?.partyType ?? 'customer');
    setOpeningBalance(party && party.openingBalance !== 0 ? paiseToInput(party.openingBalance) : '');
    setProblem(null);
  }, [open, party, defaultStateCode, initialName]);

  const handleGstinChange = (value: string) => {
    const next = value.toUpperCase().replace(/\s/g, '');
    setGstin(next);
    const fromGstin = isValidGstin(next) ? stateFromGstin(next) : null;
    if (fromGstin) setStateCode(fromGstin);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem({ message: t('partyNameRequired'), detail: '' });
    const phoneDigits = cleanPhone(phone);
    if (phoneDigits && !/^\d{10}$/.test(phoneDigits)) return setProblem({ message: t('phoneInvalid'), detail: '' });
    if (gstin.trim() && !isValidGstin(gstin)) return setProblem({ message: t('gstinInvalid'), detail: '' });
    const balance = parsePaise(openingBalance || '0');
    if (balance === null) return setProblem({ message: t('rateInvalid'), detail: '' });

    const saved: ShopParty = {
      id: party?.id ?? newId(),
      name: name.trim(),
      phone: phoneDigits,
      address: address.trim(),
      gstin: gstin.trim(),
      stateCode,
      partyType,
      openingBalance: canEditBalance ? balance : party?.openingBalance ?? 0,
      isActive: party?.isActive ?? true,
    };

    setIsSaving(true);
    try {
      if (party) await updateShopParty(saved);
      else await insertShopParty(saved);
      onSaved(saved, !party);
    } catch (err) {
      setProblem(describeDbError(err, t('partySaveFailed')));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={quick ? t('quickAddTitle') : party ? t('editParty') : t('addParty')}
      description={quick ? t('quickAddHint') : undefined}
      icon={<UserPlus className="h-5 w-5" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label={t('partyName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <FormInput
          label={`${t('partyPhone')} ${t('optional')}`}
          type="tel"
          inputMode="numeric"
          maxLength={10}
          value={phone}
          onChange={(e) => setPhone(toPhoneDigits(e.target.value))}
          placeholder="98XXXXXXXX"
        />
        {!quick && (
          <>
            <FormInput
              label={`${t('partyAddress')} ${t('optional')}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <FormInput
              label={`${t('partyGstin')} ${t('optional')}`}
              value={gstin}
              onChange={(e) => handleGstinChange(e.target.value)}
              maxLength={15}
              autoCapitalize="characters"
            />
            <PickerField
              label={t('state')}
              title={t('state')}
              icon={<MapPin className="h-5 w-5" />}
              value={stateCode}
              options={GST_STATES.map((s) => ({ value: s.code, label: s.name, description: s.code }))}
              onChange={setStateCode}
              searchable
            />
            {stateCode !== defaultStateCode && (
              <p className="text-sm font-semibold text-amber-800 -mt-2">
                {stateName(stateCode)} · {t('otherStateNote')}
              </p>
            )}
            <Segmented<PartyType>
              label={t('partyType')}
              value={partyType}
              options={[
                { value: 'customer', label: t('type_customer') },
                { value: 'supplier', label: t('type_supplier') },
                { value: 'both', label: t('type_both') },
              ]}
              onChange={setPartyType}
            />
            {canEditBalance && (
              <div className="space-y-1.5">
                <FormInput
                  label={t('openingBalance')}
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0"
                />
                <p className="text-sm text-slate-500 leading-relaxed">{t('openingBalanceHint')}</p>
              </div>
            )}
          </>
        )}

        {problem && <FormError message={problem.message} detail={problem.detail} />}

        <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
          <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={onClose} className="sm:flex-1" />
          <ActionButton
            type="submit"
            icon={<Check className="h-5 w-5" />}
            label={isSaving ? t('saving') : t('save')}
            busy={isSaving}
            className="sm:flex-1"
          />
        </div>
        {party && onDeleted && canEditBalance && (
          <DeleteZone
            key={party.id}
            label={t('deleteParty')}
            confirmText={t('deletePartyConfirm', { name: party.name })}
            onConfirm={async () => {
              try {
                onDeleted(party, await deleteShopParty(party.id));
              } catch (err) {
                setProblem(describeDbError(err, t('deleteFailed')));
                throw err;
              }
            }}
          />
        )}
      </form>
    </AppModal>
  );
}
