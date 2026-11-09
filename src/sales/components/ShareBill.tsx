import React, { useState } from 'react';
import { Download, FileText, Image as ImageIcon, Share2 } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import { saveBillFile, shareBillFile, type ShareFormat } from '../share/shareBill';
import { whatsAppNumber } from '../share/whatsapp';
import type { ShopInvoice, ShopSettings } from '../types';
import { ActionButton } from './ui';

interface ShareBillButtonProps {
  bill: ShopInvoice;
  settings: ShopSettings | null;
  /** Customer phone: shown on the sheet so the right WhatsApp chat is easy to pick. */
  phone?: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  size?: 'md' | 'lg';
  className?: string;
  /** 'icon': a small share icon (bill list cards). */
  variant?: 'button' | 'icon';
  /** Loads the full bill (with lines) when `bill` is only a list summary. */
  resolveBill?: () => Promise<ShopInvoice>;
}

/** "98260 12345", easier to check by eye. */
function spacedNumber(number: string): string {
  return `${number.slice(0, 5)} ${number.slice(5)}`;
}

/** "Share" button that opens a sheet: send the bill as a PDF or an image (no text), or save it. */
export function ShareBillButton({
  bill,
  settings,
  phone = '',
  showToast,
  size = 'md',
  className = '',
  variant = 'button',
  resolveBill,
}: ShareBillButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const number = whatsAppNumber(phone);
  const fullBill = () => (resolveBill ? resolveBill() : Promise.resolve(bill));

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      showToast(`${t('shareFailed')} ${err instanceof Error ? err.message : ''}`.trim(), 'error');
    } finally {
      setBusy(null);
    }
  };

  const share = (format: ShareFormat) =>
    run(format, async () => {
      if (!settings) return;
      const outcome = await shareBillFile(await fullBill(), settings, format);
      if (outcome === 'saved') showToast(t('shareSaved'), 'info');
      if (outcome !== 'cancelled') setOpen(false);
    });

  const save = (format: ShareFormat) =>
    run(`save-${format}`, async () => {
      if (!settings) return;
      await saveBillFile(await fullBill(), settings, format);
      showToast(t('fileSaved'), 'success');
    });

  const option = (key: string, icon: React.ReactNode, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null || !settings}
      className="w-full min-h-14 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left cursor-pointer transition-colors hover:border-slate-300 disabled:opacity-60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        {busy === key ? <Spinner /> : icon}
      </span>
      <span className="min-w-0 text-base font-bold text-slate-900">{label}</span>
    </button>
  );

  /** A big green button: the bill file goes to the share menu, where WhatsApp is picked. */
  const whatsAppOption = (format: ShareFormat, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => share(format)}
      disabled={busy !== null || !settings}
      data-testid={`share-whatsapp-${format}`}
      className="w-full min-h-20 flex flex-col items-start justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-left cursor-pointer transition-colors hover:bg-emerald-700 disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
        {busy === format ? <Spinner /> : icon}
      </span>
      <span className="text-base font-bold leading-tight text-white">{label}</span>
    </button>
  );

  const partyName = bill.partyName.trim();
  const pickHint = number
    ? t('shareWhatsAppPick', { name: partyName || spacedNumber(number), phone: spacedNumber(number) })
    : t('shareWhatsAppHint');

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          disabled={!settings}
          aria-label={t('shareBill')}
          title={t('shareBill')}
          className={`h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer disabled:opacity-40 ${className}`}
        >
          <Share2 className="h-5 w-5" />
        </button>
      ) : (
        <ActionButton
          tone="secondary"
          size={size}
          icon={<Share2 className="h-5 w-5" />}
          label={t('shareBill')}
          onClick={() => setOpen(true)}
          disabled={!settings}
          className={className}
        />
      )}
      <AppModal open={open} onClose={() => setOpen(false)} title={t('shareTitle')} description={t('shareHint')} icon={<Share2 className="h-5 w-5" />}>
        <div className="space-y-2.5">
          {/* Only the file is sent, no message. A web page cannot put a file in one chat directly,
              so the phone's share menu opens: tap WhatsApp, then the customer. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
            <p className="text-sm font-bold text-emerald-900">{t('shareWhatsApp')}</p>
            <div className="grid grid-cols-2 gap-2">
              {whatsAppOption('pdf', <FileText className="h-5 w-5" />, t('shareWhatsAppPdf'))}
              {whatsAppOption('image', <ImageIcon className="h-5 w-5" />, t('shareWhatsAppImage'))}
            </div>
            <p className="text-sm text-emerald-900/80 leading-snug">{pickHint}</p>
          </div>

          <p className="pt-1 text-sm font-semibold text-slate-500">{t('shareKeepCopy')}</p>
          <div className="grid grid-cols-2 gap-2">
            {option('save-pdf', <Download className="h-5 w-5" />, t('savePdf'), () => save('pdf'))}
            {option('save-image', <Download className="h-5 w-5" />, t('saveImage'), () => save('image'))}
          </div>
        </div>
      </AppModal>
    </>
  );
}

function Spinner() {
  return <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />;
}
