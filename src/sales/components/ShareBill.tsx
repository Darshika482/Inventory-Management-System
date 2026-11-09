import React, { useEffect, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Share2, Smartphone } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { FormInput } from '../../components/FormInput';
import { useT } from '../i18n';
import { billFileName } from '../share/billImage';
import { billFileLink, saveBillFile, shareBillFile, type ShareFormat } from '../share/shareBill';
import { canUseHelper, HELPER_APK_URL, helperLink, whatsAppNumber } from '../share/whatsapp';
import { toPhoneDigits } from '../states';
import type { ShopInvoice, ShopSettings } from '../types';
import { ActionButton } from './ui';

interface ShareBillButtonProps {
  bill: ShopInvoice;
  settings: ShopSettings | null;
  /** Customer phone: WhatsApp opens straight on their chat (with the helper app). */
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

const MIME: Record<ShareFormat, string> = { pdf: 'application/pdf', image: 'image/png' };
const EXT: Record<ShareFormat, 'pdf' | 'png'> = { pdf: 'pdf', image: 'png' };

/** True when the page goes to the background within `ms` (another app, e.g. WhatsApp, opened). */
function pageLeftWithin(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.visibilityState === 'hidden') return resolve(true);
    const onChange = () => {
      if (document.visibilityState !== 'hidden') return;
      cleanup();
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, ms);
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onChange);
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/**
 * "Share" button that opens a sheet: send the bill as a PDF or an image (only
 * the file, no text), or save it. With the Android helper app installed, the
 * file opens straight in the customer's WhatsApp chat.
 */
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
  // Android: the bill goes through the helper app, straight to the customer's chat.
  // The share menu only when the shop asks for it (or on a computer).
  const [useMenu, setUseMenu] = useState(false);
  const helper = canUseHelper() && !useMenu;
  // The helper did not open: it is not on this phone yet.
  const [helperMissing, setHelperMissing] = useState(false);
  const [typedNumber, setTypedNumber] = useState('');
  const [useOtherNumber, setUseOtherNumber] = useState(false);

  const savedNumber = whatsAppNumber(phone);
  const askNumber = !savedNumber || useOtherNumber;
  const number = askNumber ? whatsAppNumber(typedNumber) : savedNumber;
  // A number typed but not yet a full 10-digit mobile number: wait for it.
  const numberIncomplete = askNumber && typedNumber !== '' && !number;
  const partyName = bill.partyName.trim();

  const fullBill = () => (resolveBill ? resolveBill() : Promise.resolve(bill));

  // The files go online while the sheet is open, so a tap opens WhatsApp at
  // once (the phone blocks opening an app long after the tap).
  useEffect(() => {
    if (!open || !helper || !settings) return;
    fullBill()
      .then((full) => Promise.all([billFileLink(full, settings, 'pdf'), billFileLink(full, settings, 'image')]))
      .catch((err) => console.warn('The bill files for WhatsApp could not be put online yet:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, helper, settings]);

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

  /** Through the phone's share menu: tap WhatsApp, then the customer. */
  const shareMenu = (format: ShareFormat) =>
    run(format, async () => {
      if (!settings) return;
      const outcome = await shareBillFile(await fullBill(), settings, format);
      if (outcome === 'saved') showToast(t('shareSaved'), 'info');
      if (outcome !== 'cancelled') setOpen(false);
    });

  /** Through the helper app: WhatsApp opens on the customer's chat with the file attached. */
  const sendWithHelper = (format: ShareFormat) =>
    run(format, async () => {
      if (!settings) return;
      const full = await fullBill();
      let url: string;
      try {
        url = await billFileLink(full, settings, format);
      } catch {
        showToast(t('shareUploadFailed'), 'error');
        return;
      }
      setHelperMissing(false);
      window.location.href = helperLink(url, number, billFileName(full, EXT[format]), MIME[format]);
      // WhatsApp opening puts this page in the background. If it stays here, the
      // helper is not installed on this phone.
      if (await pageLeftWithin(3000)) setOpen(false);
      else setHelperMissing(true);
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

  /** A big green button: Send PDF / Send image. */
  const whatsAppOption = (format: ShareFormat, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => (helper ? sendWithHelper(format) : shareMenu(format))}
      disabled={busy !== null || !settings || (helper && numberIncomplete)}
      data-testid={`share-whatsapp-${format}`}
      className="w-full min-h-20 flex flex-col items-start justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-left cursor-pointer transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
        {busy === format ? <Spinner /> : icon}
      </span>
      <span className="text-base font-bold leading-tight text-white">{label}</span>
    </button>
  );

  const hint = !helper
    ? number
      ? t('shareWhatsAppPick', { name: partyName || spacedNumber(number), phone: spacedNumber(number) })
      : t('shareWhatsAppHint')
    : numberIncomplete
      ? t('shareNumberIncomplete')
      : number
        ? t('shareDirectTo', { name: !askNumber && partyName ? partyName : spacedNumber(number), phone: spacedNumber(number) })
        : t('shareDirectPick');

  const pill =
    'rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-bold text-emerald-800 cursor-pointer hover:bg-emerald-50';

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
          {/* Only the file is sent, never a message. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
            <p className="text-sm font-bold text-emerald-900">{t('shareWhatsApp')}</p>
            {helper && askNumber && (
              <FormInput
                label={t('shareNumberOptional')}
                type="tel"
                inputMode="numeric"
                // No length limit: a pasted "+91 98260 12345" must arrive whole to be cut to its 10 digits.
                value={typedNumber}
                onChange={(e) => setTypedNumber(toPhoneDigits(e.target.value))}
                placeholder="98XXXXXXXX"
                accent="emerald"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              {whatsAppOption('pdf', <FileText className="h-5 w-5" />, t('shareWhatsAppPdf'))}
              {whatsAppOption('image', <ImageIcon className="h-5 w-5" />, t('shareWhatsAppImage'))}
            </div>
            <p className={`text-sm leading-snug ${numberIncomplete && helper ? 'font-semibold text-red-700' : 'text-emerald-900/80'}`}>
              {hint}
            </p>
            {helper && (
              <div className="flex flex-wrap gap-2">
                {savedNumber && (
                  <button type="button" onClick={() => setUseOtherNumber((v) => !v)} className={pill}>
                    {useOtherNumber ? t('shareSavedNumber', { phone: spacedNumber(savedNumber) }) : t('shareOtherNumber')}
                  </button>
                )}
                <button type="button" onClick={() => setUseMenu(true)} className={pill}>
                  {t('shareUseMenu')}
                </button>
              </div>
            )}
            {!helper && canUseHelper() && (
              <button type="button" onClick={() => setUseMenu(false)} className={pill}>
                {t('shareUseDirect')}
              </button>
            )}
          </div>

          {/* Send PDF did not open WhatsApp: the helper app is not on this phone yet. */}
          {helper && helperMissing && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 border border-amber-200">
                  <Smartphone className="h-5 w-5" />
                </span>
                <p className="text-sm leading-snug text-slate-700">
                  <span className="block font-bold text-slate-900">{t('helperMissingTitle')}</span>
                  {t('helperMissingText')}
                </p>
              </div>
              <a
                href={HELPER_APK_URL}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white border border-amber-200 px-3 text-sm font-bold text-slate-900 hover:border-amber-300"
              >
                <Download className="h-4 w-4" />
                {t('helperDownload')}
              </a>
            </div>
          )}

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
