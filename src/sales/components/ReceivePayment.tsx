import React, { useEffect, useState } from 'react';
import { Banknote, HandCoins, Smartphone } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { describeDbError } from '../../lib/dbErrors';
import { receivePaymentRpc } from '../db';
import { newId } from '../ids';
import { useT } from '../i18n';
import { formatRupees, paiseToInput, parsePaise } from '../money';
import { upiLink } from '../print/receipt';
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
  const balance = bill ? Math.max(0, bill.total - bill.paidAmount) : 0;
  const [amountText, setAmountText] = useState('');
  const [mode, setMode] = useState<PaidMode>('cash');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; detail: string } | null>(null);
  // One id per attempt: a retry after a slow answer cannot record the money twice.
  const [clientId, setClientId] = useState(newId);

  useEffect(() => {
    if (!bill) return;
    setAmountText(paiseToInput(balance));
    setMode('cash');
    setProblem(null);
    setClientId(newId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.clientId]);

  const amount = parsePaise(amountText.trim() || '0');
  const amountOk = amount !== null && amount > 0 && amount <= balance;
  const left = amountOk ? balance - (amount as number) : balance;

  const save = async () => {
    if (!bill?.id || !amountOk) return;
    setSaving(true);
    setProblem(null);
    try {
      const paidAmount = await receivePaymentRpc({ clientId, invoiceId: bill.id, amount: amount as number, mode });
      onReceived(paidAmount, amount as number);
    } catch (err) {
      const { code = '', message = '' } = (err ?? {}) as { code?: string; message?: string };
      if (code === 'P0001' && message) setProblem({ message, detail: '' });
      else if (code === 'PGRST202') setProblem({ message: t('receivePaymentNeedsSql'), detail: '' });
      else setProblem(describeDbError(err, t('receivePaymentFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={Boolean(bill)}
      onClose={onClose}
      title={t('receivePayment')}
      description={bill ? `${bill.partyName || t('cashSale')} · ${t('balanceLeft')} ${formatRupees(balance)}` : undefined}
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

        {mode === 'upi' && amountOk && settings?.upiId && (
          <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="shrink-0 rounded-lg bg-white p-1.5 border border-slate-200">
              <QrSvg data={upiLink(settings.upiId, settings.shopName, amount)} className="h-32 w-32" />
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
          disabled={!amountOk || !bill?.id}
          onClick={save}
          className="w-full"
        />
      </div>
    </AppModal>
  );
}
