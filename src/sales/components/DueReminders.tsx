/**
 * Udhaar reminders: pick the customers who owe money (or all of them), then
 * send each one a picture of what they owe, with a UPI QR to pay, on WhatsApp.
 *
 * WhatsApp needs a tap on Send in every chat (only its paid Business API can
 * send by itself), so the customers go one after another: tap Send here,
 * tap Send in WhatsApp, come back, and the next customer is ready.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, CircleCheck, MessageCircle, SkipForward } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { fetchDueSales, fetchPaidOnAccount, fetchShopParties, uploadSharedBill } from '../db';
import { istToday } from '../fy';
import { useT } from '../i18n';
import { formatRupees } from '../money';
import { listQueuedSales } from '../outbox';
import { buildDueReminders, type DueReminder } from '../reminders';
import { reminderImageFile } from '../share/reminderImage';
import { shareFile } from '../share/shareBill';
import { canOpenChatDirectly, canUseHelper, openInHelper, setHelperMissing } from '../share/whatsapp';
import type { ShopSettings } from '../types';
import { ActionButton, ErrorState, LoadingState, SearchBox } from './ui';
import { HelperInstallCard } from './WhatsAppHelper';

type Step = 'choose' | 'send' | 'done';
type Outcome = 'sent' | 'skipped';

interface DueRemindersProps {
  open: boolean;
  onClose: () => void;
  settings: ShopSettings | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** "98260 12345", easier to check by eye. */
const spaced = (number: string) => `${number.slice(0, 5)} ${number.slice(5)}`;

export function DueRemindersSheet({ open, onClose, settings, showToast }: DueRemindersProps) {
  const { t } = useT();
  const [reminders, setReminders] = useState<DueReminder[] | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [step, setStep] = useState<Step>('choose');
  const [queue, setQueue] = useState<DueReminder[]>([]);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState(false);
  // Android with the helper app: each customer's chat opens by itself.
  const [direct, setDirect] = useState(() => canOpenChatDirectly());
  const [preview, setPreview] = useState<string | null>(null);
  // The customer whose picture is ready to send (online too, for the helper):
  // the phone only opens WhatsApp straight after a tap, so the tap must not wait.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const files = useRef(new Map<string, Promise<File>>());
  const links = useRef(new Map<string, Promise<string>>());
  const loadSeq = useRef(0);
  const today = istToday();

  const load = async () => {
    const seq = ++loadSeq.current;
    setReminders(null);
    setLoadError(null);
    try {
      const [dueBills, parties, paidOnAccount, queued] = await Promise.all([
        fetchDueSales(null),
        fetchShopParties(),
        fetchPaidOnAccount(),
        listQueuedSales(),
      ]);
      if (seq !== loadSeq.current) return;
      // Bills made on this phone and not uploaded yet count too.
      const onServer = new Set(dueBills.map((b) => b.clientId));
      const list = buildDueReminders({
        parties,
        dueBills: [...dueBills, ...queued.filter((b) => !onServer.has(b.clientId))],
        paidOnAccount,
      });
      setReminders(list);
      setSelected(new Set(list.map((r) => r.key)));
    } catch (err) {
      if (seq === loadSeq.current) setLoadError(describeDbError(err, t('remindLoadFailed')));
    }
  };

  // Each opening starts fresh, with today's amounts.
  useEffect(() => {
    if (!open) {
      loadSeq.current++;
      return;
    }
    setStep('choose');
    setQueue([]);
    setIndex(0);
    setOutcomes({});
    setSearch('');
    setDirect(canOpenChatDirectly());
    files.current.clear();
    links.current.clear();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** The customer's reminder picture, made once. */
  const fileFor = (reminder: DueReminder): Promise<File> => {
    let file = files.current.get(reminder.key);
    if (!file) {
      if (!settings) return Promise.reject(new Error(t('loadFailed')));
      file = reminderImageFile(reminder, settings, today);
      files.current.set(reminder.key, file);
      file.catch(() => files.current.delete(reminder.key));
    }
    return file;
  };

  /** The picture online, for the helper app to download (made ahead, so the tap opens WhatsApp at once). */
  const linkFor = (reminder: DueReminder): Promise<string> => {
    let link = links.current.get(reminder.key);
    if (!link) {
      link = fileFor(reminder).then(uploadSharedBill);
      links.current.set(reminder.key, link);
      link.catch(() => links.current.delete(reminder.key));
    }
    return link;
  };

  const current = step === 'send' ? queue[index] : undefined;
  const next = step === 'send' ? queue[index + 1] : undefined;

  // The customer on screen: their picture to look at; the next one is made meanwhile.
  useEffect(() => {
    if (!current || !settings) return;
    let cancelled = false;
    let url: string | null = null;
    setReadyKey(null);
    (direct ? linkFor(current) : fileFor(current))
      // A failure is shown (and tried again) on the tap.
      .catch(() => {})
      .then(() => {
        if (!cancelled) setReadyKey(current.key);
      });
    fileFor(current)
      .then((file) => {
        if (cancelled) return;
        url = URL.createObjectURL(file);
        setPreview(url);
      })
      .catch(() => {});
    if (next) fileFor(next).catch(() => {});
    if (direct) {
      linkFor(current).catch(() => {});
      if (next) linkFor(next).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setPreview(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, next?.key, direct, settings]);

  const shown = useMemo(() => {
    const list = reminders ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    const digits = query.replace(/\D/g, '');
    return list.filter((r) => r.name.toLowerCase().includes(query) || (digits.length > 2 && (r.phone ?? '').includes(digits)));
  }, [reminders, search]);

  const chosen = (reminders ?? []).filter((r) => selected.has(r.key));
  const chosenTotal = chosen.reduce((sum, r) => sum + r.total, 0);
  const allChosen = reminders !== null && reminders.length > 0 && chosen.length === reminders.length;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });

  const start = () => {
    setQueue(chosen);
    setIndex(0);
    setOutcomes({});
    setStep('send');
  };

  /** This customer is done: on to the next one, or the end. */
  const finish = (outcome: Outcome) => {
    const reminder = queue[index];
    if (!reminder) return;
    setOutcomes((prev) => ({ ...prev, [reminder.key]: outcome }));
    if (index + 1 < queue.length) setIndex(index + 1);
    else setStep('done');
  };

  const send = async () => {
    const reminder = queue[index];
    if (!reminder || !settings) return;
    setBusy(true);
    try {
      if (direct) {
        let url: string;
        try {
          url = await linkFor(reminder);
        } catch {
          showToast(t('shareUploadFailed'), 'error');
          return;
        }
        const file = await fileFor(reminder);
        // WhatsApp opening puts this page in the background; it staying here means
        // the helper is not on this phone, so the next tap uses the share menu.
        if (await openInHelper(url, reminder.phone, file.name, file.type)) finish('sent');
        else setDirect(false);
        return;
      }
      const outcome = await shareFile(await fileFor(reminder));
      if (outcome === 'saved') showToast(t('fileSaved'), 'info');
      if (outcome !== 'cancelled') finish('sent');
    } catch (err) {
      showToast(`${t('shareFailed')} ${err instanceof Error ? err.message : ''}`.trim(), 'error');
    } finally {
      setBusy(false);
    }
  };

  const breakdown = (r: DueReminder) =>
    [
      r.oldBalance !== 0 ? t('remindOld', { amount: formatRupees(r.oldBalance) }) : '',
      r.bills.length === 1
        ? t('remindOneBill', { amount: formatRupees(r.billsDue) })
        : r.bills.length > 1
          ? t('remindBills', { n: r.bills.length, amount: formatRupees(r.billsDue) })
          : '',
      r.paidOnAccount > 0 ? t('remindPaidOnAccount', { amount: formatRupees(r.paidOnAccount) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');

  const sentCount = Object.values(outcomes).filter((o) => o === 'sent').length;
  const skippedCount = Object.values(outcomes).filter((o) => o === 'skipped').length;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={step === 'choose' ? t('remindTitle') : t('remindSendingTitle')}
      description={step === 'choose' ? t('remindHint') : undefined}
      icon={<BellRing className="h-5 w-5" />}
      accent="emerald"
      fullHeight
      pinned={
        step === 'choose' && reminders && reminders.length > 0 ? (
          <div className="space-y-2">
            <SearchBox value={search} onChange={setSearch} placeholder={t('remindSearch')} />
            <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allChosen}
                onChange={() => setSelected(allChosen ? new Set() : new Set(reminders.map((r) => r.key)))}
                className="h-5 w-5 accent-emerald-600 shrink-0"
                data-testid="remind-select-all"
              />
              <span className="flex-1 text-base font-bold text-slate-900">{t('remindSelectAll', { n: reminders.length })}</span>
              <span className="text-sm font-semibold text-slate-500 tabular-nums">
                {t('remindSelected', { n: chosen.length, amount: formatRupees(chosenTotal) })}
              </span>
            </label>
          </div>
        ) : undefined
      }
    >
      {step === 'choose' &&
        (loadError ? (
          <ErrorState error={loadError} onRetry={load} />
        ) : reminders === null ? (
          <LoadingState />
        ) : reminders.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-slate-500">{t('remindNone')}</p>
        ) : (
          <div className="space-y-3">
            {shown.length === 0 ? (
              <p className="px-4 py-8 text-center text-base text-slate-500">{t('noMatch')}</p>
            ) : (
              <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden" data-testid="remind-list">
                {shown.map((r) => (
                  <li key={r.key}>
                    <label className="flex min-h-16 items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.has(r.key)}
                        onChange={() => toggle(r.key)}
                        className="h-5 w-5 accent-emerald-600 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold text-slate-900 truncate">{r.name}</span>
                        <span className="block text-sm text-slate-500 leading-snug break-words">
                          {r.phone ? spaced(r.phone) : <span className="font-semibold text-amber-700">{t('remindNoNumber')}</span>}
                          {' · '}
                          {breakdown(r)}
                        </span>
                      </span>
                      <span className="shrink-0 text-base font-extrabold text-red-700 tabular-nums">{formatRupees(r.total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="sticky bottom-0 -mx-1 px-1 pt-2 bg-white">
              <ActionButton
                tone="success"
                size="lg"
                icon={<MessageCircle className="h-5 w-5" />}
                label={
                  chosen.length === 1
                    ? t('remindStartOne', { amount: formatRupees(chosenTotal) })
                    : t('remindStart', { n: chosen.length, amount: formatRupees(chosenTotal) })
                }
                onClick={start}
                disabled={chosen.length === 0 || !settings}
                className="w-full"
                data-testid="remind-start"
              />
            </div>
          </div>
        ))}

      {step === 'send' && current && (
        <div className="space-y-3" data-testid="remind-sending">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-600">
              <span>{t('remindProgress', { n: index + 1, total: queue.length })}</span>
              <span className="tabular-nums">{t('remindSentSoFar', { n: sentCount })}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(index / queue.length) * 100}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-bold text-slate-900 leading-tight break-words">{current.name}</p>
                <p className="text-sm text-slate-500">
                  {current.phone ? spaced(current.phone) : <span className="font-semibold text-amber-700">{t('remindNoNumber')}</span>}
                </p>
              </div>
              <p className="shrink-0 text-xl font-extrabold text-red-700 tabular-nums">{formatRupees(current.total)}</p>
            </div>
            {preview ? (
              <img
                src={preview}
                alt={t('remindPreviewAlt', { name: current.name })}
                className="w-full max-h-72 object-contain object-top rounded-lg border border-slate-200 bg-slate-50"
              />
            ) : (
              <div className="h-48 rounded-lg bg-slate-100 animate-pulse" />
            )}
          </div>

          {canUseHelper() && !direct && (
            <HelperInstallCard
              onDownload={() => {
                // Installed after this: the next tap opens the chat by itself.
                setHelperMissing(false);
                setDirect(true);
              }}
            />
          )}

          <ActionButton
            tone="success"
            size="lg"
            icon={<MessageCircle className="h-5 w-5" />}
            label={t('remindSendTo', { name: current.name })}
            busy={busy || readyKey !== current.key}
            onClick={send}
            className="w-full"
            data-testid="remind-send"
          />
          <p className="text-sm text-slate-500 text-center leading-snug">
            {direct
              ? current.phone
                ? t('remindDirectHint')
                : t('remindDirectNoNumber')
              : t('remindMenuHint', { name: current.name })}
          </p>
          <button
            type="button"
            onClick={() => finish('skipped')}
            disabled={busy}
            className="w-full min-h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
            data-testid="remind-skip"
          >
            <SkipForward className="h-4 w-4" />
            {t('remindSkip')}
          </button>

          {/* Everyone in this round, with who is done. */}
          <ol className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden text-sm">
            {queue.map((r, i) => {
              const outcome = outcomes[r.key];
              return (
                <li key={r.key} className={`flex items-center gap-2 px-3 py-2 ${i === index ? 'bg-emerald-50' : ''}`}>
                  <span className="w-5 shrink-0 text-center">
                    {outcome === 'sent' ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : outcome === 'skipped' ? (
                      <SkipForward className="h-4 w-4 text-slate-400" />
                    ) : (
                      <span className="text-xs font-bold text-slate-400">{i + 1}</span>
                    )}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${i === index ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{r.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {outcome === 'sent' ? t('remindSent') : outcome === 'skipped' ? t('remindSkipped') : formatRupees(r.total)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4 py-4 text-center" data-testid="remind-done">
          <CircleCheck className="mx-auto h-14 w-14 text-emerald-600" />
          <p className="text-xl font-bold text-slate-900">
            {sentCount === 1 ? t('remindDoneOne') : t('remindDoneTitle', { n: sentCount })}
          </p>
          {skippedCount > 0 && <p className="text-base text-slate-500">{t('remindDoneSkipped', { n: skippedCount })}</p>}
          <ActionButton icon={<Check className="h-5 w-5" />} label={t('done')} onClick={onClose} className="w-full" />
        </div>
      )}
    </AppModal>
  );
}
