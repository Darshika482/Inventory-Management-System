import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, MessageCircle, RotateCcw, Share2 } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { FormInput } from '../../components/FormInput';
import { useT } from '../i18n';
import { billShareText } from '../share/billImage';
import { billLink, saveBillFile, shareBillFile, type ShareFormat } from '../share/shareBill';
import { whatsAppChatUrl, whatsAppNumber } from '../share/whatsapp';
import { toPhoneDigits } from '../states';
import type { ShopInvoice, ShopSettings } from '../types';
import { ActionButton } from './ui';

interface ShareBillButtonProps {
  bill: ShopInvoice;
  settings: ShopSettings | null;
  /** Customer phone: WhatsApp opens straight on their chat. */
  phone?: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  size?: 'md' | 'lg';
  className?: string;
  /** 'icon': a small share icon (bill list cards). */
  variant?: 'button' | 'icon';
  /** Loads the full bill (with lines) when `bill` is only a list summary. */
  resolveBill?: () => Promise<ShopInvoice>;
}

type LinkState = { status: 'making' } | { status: 'ready'; url: string } | { status: 'failed' };

/** "98260 12345", easier to check by eye. */
function spacedNumber(number: string): string {
  return `${number.slice(0, 5)} ${number.slice(5)}`;
}

/** "Share" button that opens a sheet: WhatsApp to the customer, image, PDF, or save. */
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
  const [link, setLink] = useState<LinkState>({ status: 'making' });
  const [typedNumber, setTypedNumber] = useState('');
  const [useOtherNumber, setUseOtherNumber] = useState(false);
  const linkAttempt = useRef(0);

  const savedNumber = whatsAppNumber(phone);
  const askNumber = !savedNumber || useOtherNumber;
  const number = askNumber ? whatsAppNumber(typedNumber) : savedNumber;

  const fullBill = () => (resolveBill ? resolveBill() : Promise.resolve(bill));

  const makeLink = () => {
    if (!settings) return;
    const attempt = ++linkAttempt.current;
    setLink({ status: 'making' });
    fullBill()
      .then((full) => billLink(full, settings))
      .then((url) => {
        if (attempt === linkAttempt.current) setLink({ status: 'ready', url });
      })
      .catch((err) => {
        console.warn('The bill link for WhatsApp could not be made:', err);
        if (attempt === linkAttempt.current) setLink({ status: 'failed' });
      });
  };

  // The bill goes online while the sheet is open, so the WhatsApp tap opens
  // the chat at once (a chat opened after a long wait is blocked by the phone).
  useEffect(() => {
    if (open) makeLink();
    else linkAttempt.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

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
        {busy === key ? <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : icon}
      </span>
      <span className="min-w-0 text-base font-bold text-slate-900">{label}</span>
    </button>
  );

  const waUrl =
    settings && number && link.status !== 'making'
      ? whatsAppChatUrl(number, billShareText(bill, settings, link.status === 'ready' ? link.url : undefined))
      : undefined;
  const partyName = bill.partyName.trim();
  const waHint = !number
    ? t('shareNumberNeeded')
    : link.status === 'making'
      ? t('shareLinkMaking')
      : link.status === 'failed'
        ? t('shareLinkFailed')
        : `${spacedNumber(number)} · ${t('shareWhatsAppHint')}`;

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
          {/* WhatsApp straight to the customer's chat: the bill goes as a link, the one thing a web page can fill in there. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
            {askNumber && (
              <FormInput
                label={t('shareNumberLabel')}
                type="tel"
                inputMode="numeric"
                // No length limit: a pasted "+91 98260 12345" must arrive whole to be cut to its 10 digits.
                value={typedNumber}
                onChange={(e) => setTypedNumber(toPhoneDigits(e.target.value))}
                placeholder="98XXXXXXXX"
                accent="emerald"
              />
            )}
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!waUrl}
              onClick={(e) => {
                if (!waUrl) {
                  e.preventDefault();
                  return;
                }
                // Closed a moment later, so the tap still opens WhatsApp.
                setTimeout(() => setOpen(false), 500);
              }}
              className={`w-full min-h-16 flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                waUrl ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer' : 'bg-emerald-600/60 cursor-not-allowed'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                {number && link.status === 'making' ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold text-white line-clamp-2 break-words">
                  {partyName ? t('shareWhatsAppTo', { name: partyName }) : t('shareWhatsApp')}
                </span>
                <span className="block text-sm text-emerald-50">{waHint}</span>
              </span>
            </a>
            {(link.status === 'failed' || savedNumber) && (
              <div className="flex flex-wrap gap-2">
                {link.status === 'failed' && (
                  <button
                    type="button"
                    onClick={makeLink}
                    className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-bold text-emerald-800 cursor-pointer hover:bg-emerald-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('tryAgain')}
                  </button>
                )}
                {savedNumber && (
                  <button
                    type="button"
                    onClick={() => setUseOtherNumber((v) => !v)}
                    className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-bold text-emerald-800 cursor-pointer hover:bg-emerald-50"
                  >
                    {useOtherNumber ? t('shareSavedNumber', { phone: spacedNumber(savedNumber) }) : t('shareOtherNumber')}
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="pt-1 text-sm font-semibold text-slate-500">{t('shareOtherApps')}</p>
          <div className="grid grid-cols-2 gap-2">
            {option('image', <ImageIcon className="h-5 w-5" />, t('shareAsImage'), () => share('image'))}
            {option('pdf', <FileText className="h-5 w-5" />, t('shareAsPdf'), () => share('pdf'))}
            {option('save-image', <Download className="h-5 w-5" />, t('saveImage'), () => save('image'))}
            {option('save-pdf', <Download className="h-5 w-5" />, t('savePdf'), () => save('pdf'))}
          </div>
        </div>
      </AppModal>
    </>
  );
}
