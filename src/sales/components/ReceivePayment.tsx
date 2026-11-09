import React, { useEffect, useState } from 'react';
import { Banknote, HandCoins, Smartphone } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { describeDbError } from '../../lib/dbErrors';
import { receiveOldBalanceRpc, receivePaymentRpc } from '../db';
import { newId } from '../ids';
import { useT } from '../i18n';
import { formatRupees, paiseToInput, parsePaise, type Paise } from '../money';
import { upiLink, upiPayee } from '../print/receipt';
import type { PaidMode, ShopInvoice, ShopSettings } from '../types';
import { QrSvg } from './PrintUi';
import { FormError } from '../../components/FormInput';
import { ActionButton } from './ui';

interface ReceivePaymentModalProps {
  /** The udhaar / part-paid bill; null closes the sheet. */
  bill: ShopInvoice | null;
  settings: ShopSettings | null;
  onClose: () => void;
  /** After the server saved it: the bill's new paid amount and what was received. */
  onReceived: (paidAmount: number, received: number) => void;
}

/** Money received later against an udhaar bill: amount, cash or UPI, save. */
export function ReceivePaymentModal({ bill, settings, onClose, onReceived }: ReceivePaymentModalProps) {
  const { t } = useT();
  const target: PaymentTarget | null = bill
    ? {
        key: bill.clientId,
        name: bill.partyName || t('cashSale'),
        balance: Math.max(0, bill.total - bill.paidAmount),
        canSave: Boolean(bill.id),
        needsSql: t('receivePaymentNeedsSql'),
        save: async (clientId, amount, mode) => {
          const paidAmount = await receivePaymentRpc({ clientId, invoiceId: bill.id as string, amount, mode });
          onReceived(paidAmount, amount);
        },
      }
    : null;
  return <PaymentSheet target={target} settings={settings} onClose={onClose} />;
}

/** A customer's old balance (from before the app) that is still to be paid. */
export interface OldBalanceDue {
  partyId: string;
  name: string;
  /** Old balance less what they already paid towards it. */
  left: Paise;
}

/** Money a customer paid towards their old balance: amount, cash or UPI, save. */
export function ReceiveOldBalanceModal({
  customer,
  settings,
  onClose,
  onReceived,
}: {
  customer: OldBalanceDue | null;
  settings: ShopSettings | null;
  onClose: () => void;
  /** After the server saved it: what they have now paid without a bill, and what was received. */
  onReceived: (paidOnAccount: Paise, received: Paise) => void;
}) {
  const { t } = useT();
  const target: PaymentTarget | null = customer
    ? {
        key: `old:${customer.partyId}`,
        name: customer.name,
        title: t('receiveOldBalance'),
        balanceLabel: t('oldBalanceLeft'),
        balance: customer.left,
        canSave: true,
        needsSql: t('oldBalanceNeedsSql'),
        save: async (clientId, amount, mode) => {
          const paid = await receiveOldBalanceRpc({ clientId, partyId: customer.partyId, amount, mode });
          onReceived(paid, amount);
        },
      }
    : null;
  return <PaymentSheet target={target} settings={settings} onClose={onClose} />;
}

/** What money is being received for: a bill, or a customer's old balance. */
interface PaymentTarget {
  /** A new target starts afresh. */
  key: string;
  name: string;
  title?: string;
  balanceLabel?: string;
  /** The most that can be received. */
  balance: Paise;
  canSave: boolean;
  /** Shown when the database function is not there yet. */
  needsSql: string;
  save: (clientId: string, amount: Paise, mode: PaidMode) => Promise<void>;
}

function PaymentSheet({
  target,
  settings,
  onClose,
}: {
  target: PaymentTarget | null;
  settings: ShopSettings | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const balance = target ? target.balance : 0;
  const payee = settings ? upiPayee(settings) : null;
  const [amountText, setAmountText] = useState('');
  const [mode, setMode] = useState<PaidMode>('cash');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; detail: string } | null>(null);
  // One id per attempt: a retry after a slow answer cannot record the money twice.
  const [clientId, setClientId] = useState(newId);

  useEffect(() => {
    if (!target) return;
    setAmountText(paiseToInput(balance));
    setMode('cash');
    setProblem(null);
    setClientId(newId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key]);

  const amount = parsePaise(amountText.trim() || '0');
  const amountOk = amount !== null && amount > 0 && amount <= balance;
  const left = amountOk ? balance - (amount as number) : balance;

  const save = async () => {
    if (!target?.canSave || !amountOk) return;
    setSaving(true);
    setProblem(null);
    try {
      await target.save(clientId, amount as number, mode);
    } catch (err) {
      const { code = '', message = '' } = (err ?? {}) as { code?: string; message?: string };
      if (code === 'P0001' && message) setProblem({ message, detail: '' });
      else if (code === 'PGRST202') setProblem({ message: target.needsSql, detail: '' });
      else setProblem(describeDbError(err, t('receivePaymentFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={Boolean(target)}
      onClose={onClose}
      title={target?.title ?? t('receivePayment')}
      description={target ? `${target.name} · ${target.balanceLabel ?? t('balanceLeft')} ${formatRupees(balance)}` : undefined}
      icon={<HandCoins className="h-5 w-5" />}
      accent="emerald"
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-sm font-bold text-slate-700">{t('amountReceived')}</span>
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 h-14 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden focus-within:border-amber-500 focus-within:bg-white transition-colors">
              <span className="pl-3.5 flex items-center text-lg font-semibold text-slate-400" aria-hidden="true">
                ₹
              </span>
              <input
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                data-testid="payment-amount"
                className="min-w-0 flex-1 bg-transparent px-2 text-xl font-bold text-slate-900 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setAmountText(paiseToInput(balance))}
              className={`shrink-0 min-h-14 px-3 rounded-xl border text-sm font-bold cursor-pointer ${
                amount === balance ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {t('fullBalance')}
            </button>
          </div>
        </label>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('payment')}>
          {(
            [
              { value: 'cash', icon: Banknote },
              { value: 'upi', icon: Smartphone },
            ] as const
          ).map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`min-h-12 flex items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold cursor-pointer ${
                mode === value
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(`pay_${value}`)}
            </button>
          ))}
        </div>

        {mode === 'upi' && amountOk && payee && (
          <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="shrink-0 rounded-lg bg-white p-1.5 border border-slate-200">
              <QrSvg data={upiLink(payee.upiId, payee.name, amount, payee.merchantCode)} className="h-32 w-32" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-600">{t('upiQrScan')}</p>
              <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{formatRupees(amount as number, true)}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#DCFCE7] px-3 py-2">
            <p className="text-xs font-bold text-[#166534]">{t('receivedLabel')}</p>
            <p className="text-lg font-extrabold text-[#166534] tabular-nums">{formatRupees(amountOk ? (amount as number) : 0, true)}</p>
          </div>
          <div className={`rounded-xl px-3 py-2 ${left > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
            <p className={`text-xs font-bold ${left > 0 ? 'text-red-700' : 'text-slate-500'}`}>{t('balanceAfter')}</p>
            <p className={`text-lg font-extrabold tabular-nums ${left > 0 ? 'text-red-700' : 'text-slate-500'}`}>{formatRupees(left, true)}</p>
          </div>
        </div>

        {!amountOk && amountText.trim() !== '' && (
          <p className="text-sm font-semibold text-red-700">{t('paymentAmountInvalid', { amount: formatRupees(balance, true) })}</p>
        )}
        {problem && <FormError message={problem.message} detail={problem.detail} />}

        <ActionButton
          size="lg"
          tone="success"
          icon={<HandCoins className="h-5 w-5" />}
          label={t('savePayment')}
          busy={saving}
          disabled={!amountOk || !target?.canSave}
          onClick={save}
          className="w-full"
        />
      </div>
    </AppModal>
  );
}
