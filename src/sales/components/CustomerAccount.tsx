/**
 * One customer's account (owner): every bill with its date, the old balance
 * (from before the app), the money they paid, and the udhaar they owe now —
 * old balance included. Tapping the udhaar total shows what it is made of:
 * the old balance, each payment towards it, and each bill with a balance.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, HandCoins, Pencil, Phone, ReceiptText, User as UserIcon } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { ShowMoreButton, useShowMore } from '../../components/ShowMore';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { buildCustomerAccount, billDue, type AccountPayment, type UdhaarPart } from '../account';
import { fetchPartyPayments, fetchPartySales } from '../db';
import { billLabel, billTitle, formatBillDate } from '../fy';
import { useT, type TranslationKey } from '../i18n';
import { formatRupees } from '../money';
import { listQueuedSales } from '../outbox';
import type { ShopInvoice, ShopParty, ShopSettings } from '../types';
import { ActionButton, LoadingState } from './ui';
import { ReceiveOldBalanceModal, type OldBalanceDue } from './ReceivePayment';

const normalName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** What the bill screen of the host page needs to show one bill on top of the account. */
export interface AccountBillDetail {
  bill: ShopInvoice;
  onClose: () => void;
  /** A payment was received on the bill: its new paid amount. */
  onPaid: (clientId: string, paidAmount: number) => void;
}

interface CustomerAccountModalProps {
  /** The customer to show; null keeps the sheet closed. */
  party: ShopParty | null;
  /** All customers, to tell whether bills typed with just a name are theirs. */
  parties: ShopParty[];
  settings: ShopSettings | null;
  onClose: () => void;
  /** Opens the customer's details for changing. */
  onEditDetails?: (party: ShopParty) => void;
  /** The host page draws the bill detail sheet (with print, share, receive payment). */
  renderBillDetail: (detail: AccountBillDetail) => React.ReactNode;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** Money was received: the host can refresh its own udhaar numbers. */
  onChanged?: () => void;
}

export function CustomerAccountModal({
  party,
  parties,
  settings,
  onClose,
  onEditDetails,
  renderBillDetail,
  showToast,
  onChanged,
}: CustomerAccountModalProps) {
  const { t } = useT();
  const [bills, setBills] = useState<ShopInvoice[]>([]);
  const [payments, setPayments] = useState<AccountPayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [showParts, setShowParts] = useState(false);
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [oldPaying, setOldPaying] = useState<OldBalanceDue | null>(null);

  // Bills typed with only a name count for this customer when no other customer has that name.
  const matchName = useMemo(() => {
    if (!party) return null;
    const key = normalName(party.name);
    return parties.filter((p) => normalName(p.name) === key).length <= 1 ? party.name : null;
  }, [party, parties]);

  const load = async (target: ShopParty) => {
    setIsLoading(true);
    setProblem(null);
    try {
      const [serverBills, partyPayments, queued] = await Promise.all([
        fetchPartySales(target.id, matchName),
        fetchPartyPayments(target.id),
        listQueuedSales(),
      ]);
      const waiting = queued.filter(
        (b) => b.partyId === target.id || (!b.partyId && matchName && normalName(b.partyName) === normalName(matchName))
      );
      setBills([...serverBills, ...waiting]);
      setPayments(partyPayments);
    } catch (err) {
      setProblem(describeDbError(err, 'The customer account could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setBills([]);
    setPayments([]);
    setShowParts(false);
    setOpenClientId(null);
    setOldPaying(null);
    if (party) void load(party);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.id]);

  const account = useMemo(
    () => (party ? buildCustomerAccount({ party, bills, payments }) : null),
    [party, bills, payments]
  );
  const shownBills = useShowMore(account?.bills ?? [], party?.id ?? '');
  const shownPayments = useShowMore(account?.payments ?? [], `pay|${party?.id ?? ''}`);
  const byInvoiceId = useMemo(() => new Map(bills.filter((b) => b.id).map((b) => [b.id as string, b])), [bills]);
  const openBill = openClientId ? (account?.bills.find((b) => b.clientId === openClientId) ?? null) : null;

  if (!party) return null;

  const total = account?.total ?? 0;
  const summary = account
    ? [
        account.oldBalance !== 0 ? t('remindOld', { amount: formatRupees(account.oldBalance) }) : '',
        account.dueCount === 1
          ? t('remindOneBill', { amount: formatRupees(account.billsDue) })
          : account.dueCount > 1
            ? t('remindBills', { n: account.dueCount, amount: formatRupees(account.billsDue) })
            : '',
        account.paidOnAccount > 0 ? t('remindPaidOnAccount', { amount: formatRupees(account.paidOnAccount) }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <AppModal
      open
      onClose={onClose}
      title={party.name}
      description={[party.phone, party.address].filter(Boolean).join(' · ') || undefined}
      icon={<UserIcon className="h-5 w-5" />}
      fullHeight
    >
      <div className="space-y-4" data-testid="customer-account">
        {isLoading && !account?.bills.length ? (
          <LoadingState />
        ) : problem ? (
          <div className="space-y-3">
            <p className="text-base text-red-700">{problem.message}</p>
            {problem.detail && <p className="text-xs text-red-600/80 break-words">{problem.detail}</p>}
            <ActionButton tone="secondary" icon={<ReceiptText className="h-5 w-5" />} label={t('tryAgain')} onClick={() => load(party)} />
          </div>
        ) : account ? (
          <>
            {/* The udhaar total, old balance included. Tap: what it is made of. */}
            <button
              type="button"
              onClick={() => setShowParts((v) => !v)}
              aria-expanded={showParts}
              className={`w-full rounded-xl border px-4 py-3 text-left cursor-pointer ${
                total > 0 ? 'bg-red-50 border-red-200' : 'bg-[#DCFCE7] border-[#BBF7D0]'
              }`}
              data-testid="account-total"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-600">{t('acctTotalUdhaar')}</span>
                <span className={`text-2xl font-extrabold tabular-nums ${total > 0 ? 'text-red-700' : 'text-[#166534]'}`}>
                  {formatRupees(Math.max(0, total))}
                </span>
              </span>
              {total < 0 && (
                <span className="block text-sm font-semibold text-[#166534]">{t('acctShopOwes', { amount: formatRupees(-total) })}</span>
              )}
              {summary && <span className="block text-sm text-slate-600 mt-0.5">{summary}</span>}
              <span className="mt-1 flex items-center gap-1 text-sm font-bold text-amber-700">
                {showParts ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {showParts ? t('acctHideDetails') : t('acctTapDetails')}
              </span>
            </button>

            {showParts && (
              <UdhaarParts parts={account.parts} total={total} onOpenBill={setOpenClientId} />
            )}

            <div className="flex flex-wrap gap-2">
              {account.oldLeft > 0 && (
                <ActionButton
                  tone="success"
                  icon={<HandCoins className="h-5 w-5" />}
                  label={t('receiveOldBalance')}
                  onClick={() => setOldPaying({ partyId: party.id, name: party.name, left: account.oldLeft })}
                  className="flex-1"
                  data-testid="account-receive-old"
                />
              )}
              {party.phone && (
                <a
                  href={`tel:${party.phone}`}
                  className="flex-1 min-h-12 px-4 flex items-center justify-center gap-2 rounded-xl font-bold border border-slate-300 bg-white text-slate-800"
                >
                  <Phone className="h-5 w-5" />
                  {t('acctCall')}
                </a>
              )}
              {onEditDetails && (
                <ActionButton
                  tone="secondary"
                  icon={<Pencil className="h-5 w-5" />}
                  label={t('editParty')}
                  onClick={() => onEditDetails(party)}
                  className="flex-1"
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <SmallTile label={t('acctBillsTotal')} value={formatRupees(account.billsTotal)} />
              <SmallTile label={t('paid')} value={formatRupees(account.billsPaid)} tone="emerald" />
              <SmallTile label={t('acctBillsLeft')} value={formatRupees(account.billsDue)} tone={account.billsDue > 0 ? 'red' : 'default'} />
            </div>

            {/* Every bill, newest first. */}
            <section className="space-y-2">
              <p className="text-sm font-bold text-slate-700">{t('acctBills', { n: account.bills.length })}</p>
              {account.bills.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl">{t('acctNoBills')}</p>
              ) : (
                <>
                  <ul className="space-y-2" data-testid="account-bills">
                    {shownBills.visible.map((bill) => (
                      <li key={bill.clientId}>
                        <AccountBillRow bill={bill} onOpen={() => setOpenClientId(bill.clientId)} />
                      </li>
                    ))}
                  </ul>
                  <ShowMoreButton hidden={shownBills.hidden} onMore={shownBills.showMore} label={t('showMore', { n: shownBills.hidden })} />
                </>
              )}
            </section>

            {account.payments.length > 0 && (
              <section className="space-y-2">
                <p className="text-sm font-bold text-slate-700">{t('acctPayments', { n: account.payments.length })}</p>
                <ul className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl" data-testid="account-payments">
                  {shownPayments.visible.map((p) => {
                    const onBill = p.invoiceId ? byInvoiceId.get(p.invoiceId) : undefined;
                    return (
                      <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-800">
                            {formatBillDate(p.paymentDate)} · {modeLabel(p.mode, t)}
                          </span>
                          <span className="block text-sm text-slate-500 truncate">
                            {p.invoiceId
                              ? t('acctOnBill', { bill: (onBill && billLabel(onBill.billNumber)) || '—' })
                              : t('acctTowardsOld')}
                          </span>
                        </span>
                        <span className="shrink-0 text-base font-extrabold tabular-nums text-[#166534]">{formatRupees(p.amount)}</span>
                      </li>
                    );
                  })}
                </ul>
                <ShowMoreButton hidden={shownPayments.hidden} onMore={shownPayments.showMore} label={t('showMore', { n: shownPayments.hidden })} />
              </section>
            )}
          </>
        ) : null}
      </div>

      {openBill &&
        renderBillDetail({
          bill: openBill,
          onClose: () => setOpenClientId(null),
          onPaid: (clientId, paidAmount) => {
            setBills((prev) => prev.map((b) => (b.clientId === clientId ? { ...b, paidAmount } : b)));
            // The payment shows in the list with its date.
            fetchPartyPayments(party.id)
              .then(setPayments)
              .catch(() => {});
            onChanged?.();
          },
        })}

      <ReceiveOldBalanceModal
        customer={oldPaying}
        settings={settings}
        onClose={() => setOldPaying(null)}
        onReceived={(_paid, received) => {
          const customer = oldPaying;
          setOldPaying(null);
          if (!customer) return;
          showToast(
            t('oldBalanceReceived', {
              amount: formatRupees(received),
              name: customer.name,
              left: formatRupees(Math.max(0, customer.left - received)),
            }),
            'success'
          );
          fetchPartyPayments(party.id)
            .then(setPayments)
            .catch(() => {});
          onChanged?.();
        }}
      />
    </AppModal>
  );
}

function modeLabel(mode: string, t: (key: TranslationKey) => string): string {
  if (mode === 'cash') return t('pay_cash');
  if (mode === 'upi') return t('pay_upi');
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** The parts the udhaar total is made of, adding up to it. */
function UdhaarParts({ parts, total, onOpenBill }: { parts: UdhaarPart[]; total: number; onOpenBill: (clientId: string) => void }) {
  const { t } = useT();
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="udhaar-parts">
      {parts.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{t('acctNothingDue')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {parts.map((part, i) => {
            if (part.kind === 'old') {
              return (
                <PartRow key={`old-${i}`} label={t('partOld')} amount={formatRupees(part.amount)} tone={part.amount < 0 ? 'minus' : 'plus'} />
              );
            }
            if (part.kind === 'paidOld') {
              return (
                <PartRow
                  key={`paid-${i}`}
                  label={t('partPaidOld', { date: formatBillDate(part.paymentDate) })}
                  hint={modeLabel(part.mode, t)}
                  amount={`− ${formatRupees(part.amount)}`}
                  tone="minus"
                />
              );
            }
            return (
              <li key={part.clientId}>
                <button
                  type="button"
                  onClick={() => onOpenBill(part.clientId)}
                  className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-amber-50/50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">
                      {t('partBill', { bill: billLabel(part.billNumber) ?? t('numberOnUpload'), date: formatBillDate(part.billDate) })}
                    </span>
                    {part.paid > 0 && (
                      <span className="block text-sm text-slate-500">
                        {t('partBillPaid', { total: formatRupees(part.total), paid: formatRupees(part.paid) })}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-base font-bold tabular-nums text-red-700">{formatRupees(part.due)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-slate-50 border-t border-slate-200">
        <span className="text-sm font-bold text-slate-700">{t('acctTotalUdhaar')}</span>
        <span className={`text-lg font-extrabold tabular-nums ${total > 0 ? 'text-red-700' : 'text-[#166534]'}`}>
          {formatRupees(total)}
        </span>
      </div>
    </div>
  );
}

function PartRow({ label, hint, amount, tone }: { label: string; hint?: string; amount: string; tone: 'plus' | 'minus' }) {
  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint && <span className="block text-sm text-slate-500">{hint}</span>}
      </span>
      <span className={`shrink-0 text-base font-bold tabular-nums ${tone === 'minus' ? 'text-[#166534]' : 'text-red-700'}`}>{amount}</span>
    </li>
  );
}

function SmallTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'emerald' | 'red' }) {
  const styles = {
    default: 'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]',
    red: 'bg-red-50 border-red-200 text-red-700',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 min-w-0 ${styles}`}>
      <p className="text-xs opacity-80 truncate">{label}</p>
      <p className="text-base font-extrabold tabular-nums truncate">{value}</p>
    </div>
  );
}

/** One bill in the account: number, date, total, and what is left on it. */
function AccountBillRow({ bill, onOpen }: { bill: ShopInvoice; onOpen: () => void }) {
  const { t } = useT();
  const due = billDue(bill);
  const status =
    bill.syncState === 'pending'
      ? { text: t('waitingUpload'), style: 'bg-amber-100 text-amber-800' }
      : bill.syncState === 'failed'
        ? { text: t('uploadFailed'), style: 'bg-red-100 text-red-700' }
        : bill.status === 'cancelled'
          ? { text: t('status_cancelled'), style: 'bg-slate-200 text-slate-600' }
          : due === 0
            ? { text: t('status_paid'), style: 'bg-emerald-100 text-emerald-700' }
            : { text: t('acctUdhaarLeft', { amount: formatRupees(due) }), style: 'bg-red-100 text-red-700' };
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-14 flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-left cursor-pointer hover:border-amber-300"
    >
      <span className="min-w-0">
        <span className="block text-base font-bold text-slate-900 truncate">{billTitle(bill) ?? t('numberOnUpload')}</span>
        <span className="block text-sm text-slate-500">{formatBillDate(bill.billDate)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block text-base font-extrabold tabular-nums ${bill.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {formatRupees(bill.total)}
        </span>
        <span className={`inline-block mt-0.5 px-2 py-0.5 text-xs font-bold rounded-full ${status.style}`}>{status.text}</span>
      </span>
    </button>
  );
}
