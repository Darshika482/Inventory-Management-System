import React, { useState } from 'react';
import { Download, FileText, Image as ImageIcon, MessageCircle, Share2 } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import { saveBillFile, shareBillFile, whatsAppLink, type ShareFormat } from '../share/shareBill';
import type { ShopInvoice, ShopSettings } from '../types';
import { ActionButton } from './ui';

interface ShareBillButtonProps {
  bill: ShopInvoice;
  settings: ShopSettings | null;
  /** Customer phone, for the WhatsApp message. */
  phone?: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  size?: 'md' | 'lg';
  className?: string;
}

/** "Share" button that opens a sheet: image, PDF, WhatsApp text, or save. */
export function ShareBillButton({ bill, settings, phone = '', showToast, size = 'md', className = '' }: ShareBillButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
      const outcome = await shareBillFile(bill, settings, format);
      if (outcome === 'saved') showToast(t('shareSaved'), 'info');
      if (outcome !== 'cancelled') setOpen(false);
    });

  const save = (format: ShareFormat) =>
    run(`save-${format}`, async () => {
      if (!settings) return;
      await saveBillFile(bill, settings, format);
      showToast(t('fileSaved'), 'success');
    });

  const option = (
    key: string,
    icon: React.ReactNode,
    label: string,
    hint: string | null,
    onClick: () => void,
    tone: 'green' | 'plain' = 'plain'
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null || !settings}
      className={`w-full min-h-14 flex items-center gap-3 rounded-xl border px-4 py-3 text-left cursor-pointer transition-colors disabled:opacity-60 ${
        tone === 'green' ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          tone === 'green' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
        }`}
      >
        {busy === key ? <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-bold text-slate-900">{label}</span>
        {hint && <span className="block text-sm text-slate-500">{hint}</span>}
      </span>
    </button>
  );

  return (
    <>
      <ActionButton
        tone="secondary"
        size={size}
        icon={<Share2 className="h-5 w-5" />}
        label={t('shareBill')}
        onClick={() => setOpen(true)}
        disabled={!settings}
        className={className}
      />
      <AppModal open={open} onClose={() => setOpen(false)} title={t('shareTitle')} description={t('shareHint')} icon={<Share2 className="h-5 w-5" />}>
        <div className="space-y-2.5">
          {option('image', <ImageIcon className="h-5 w-5" />, t('shareAsImage'), null, () => share('image'), 'green')}
          {option('pdf', <FileText className="h-5 w-5" />, t('shareAsPdf'), null, () => share('pdf'), 'green')}
          {option(
            'wa',
            <MessageCircle className="h-5 w-5" />,
            t('shareWhatsAppText'),
            t('shareWhatsAppTextHint'),
            () => settings && window.open(whatsAppLink(bill, settings, phone), '_blank', 'noopener')
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {option('save-image', <Download className="h-5 w-5" />, t('saveImage'), null, () => save('image'))}
            {option('save-pdf', <Download className="h-5 w-5" />, t('savePdf'), null, () => save('pdf'))}
          </div>
        </div>
      </AppModal>
    </>
  );
}
