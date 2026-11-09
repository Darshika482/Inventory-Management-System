import React, { useEffect, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Share2 } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { FormInput } from '../../components/FormInput';
import { useT } from '../i18n';
import { billFileName } from '../share/billImage';
import { billFileLink, saveBillFile, shareBillFile, type ShareFormat } from '../share/shareBill';
import { canOpenChatDirectly, canUseHelper, openInHelper, setHelperMissing, whatsAppNumber } from '../share/whatsapp';
import { toPhoneDigits } from '../states';
import type { ShopInvoice, ShopSettings } from '../types';
import { ActionButton } from './ui';
import { HelperInstallCard } from './WhatsAppHelper';

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
  // Android with the helper app: the customer's chat opens by itself with the
  // file attached. Without it (or on a computer): the phone's share menu.
  const [direct, setDirect] = useState(() => canOpenChatDirectly());
  const [typedNumber, setTypedNumber] = useState('');

  const savedNumber = whatsAppNumber(phone);
  // A number is asked for only when the chat can open by itself and none is saved.
  const askNumber = direct && !savedNumber;
  const number = savedNumber ?? whatsAppNumber(typedNumber);
  // A number typed but not yet a full 10-digit mobile number: wait for it.
  const numberIncomplete = askNumber && typedNumber !== '' && !number;
  const partyName = bill.partyName.trim();

  const fullBill = () => (resolveBill ? resolveBill() : Promise.resolve(bill));

  // The files go online while the sheet is open, so a tap opens WhatsApp at
  // once (the phone blocks opening an app long after the tap).
  useEffect(() => {
    if (open) setDirect(canOpenChatDirectly());
  }, [open]);
  useEffect(() => {
    if (!open || !direct || !settings) return;
    fullBill()
      .then((full) => Promise.all([billFileLink(full, settings, 'pdf'), billFileLink(full, settings, 'image')]))
      .catch((err) => console.warn('The bill files for WhatsApp could not be put online yet:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, direct, settings]);

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
      // WhatsApp opening puts this page in the background. If it stays here, the
      // helper is not on this phone: from now on the share menu is used.
      if (await openInHelper(url, number, billFileName(full, EXT[format]), MIME[format])) setOpen(false);
      else setDirect(false);
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
      onClick={() => (direct ? sendWithHelper(format) : shareMenu(format))}
      disabled={busy !== null || !settings || numberIncomplete}
      data-testid={`share-whatsapp-${format}`}
      className="w-full min-h-20 flex flex-col items-start justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-left cursor-pointer transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
        {busy === format ? <Spinner /> : icon}
      </span>
      <span className="text-base font-bold leading-tight text-white">{label}</span>
    </button>
  );

  const hint = !direct
    ? number
      ? t('shareWhatsAppPick', { name: partyName || spacedNumber(number), phone: spacedNumber(number) })
      : t('shareWhatsAppHint')
    : numberIncomplete
      ? t('shareNumberIncomplete')
      : number
        ? t('shareDirectTo', { name: savedNumber && partyName ? partyName : spacedNumber(number), phone: spacedNumber(number) })
        : t('shareDirectPick');

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
            {askNumber && (
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
            <p className={`text-sm leading-snug ${numberIncomplete ? 'font-semibold text-red-700' : 'text-emerald-900/80'}`}>
              {hint}
            </p>
          </div>

          {/* WhatsApp did not open by itself: the helper app is not on this phone yet. */}
          {canUseHelper() && !direct && (
            <HelperInstallCard
              onDownload={() => {
                // Installed after this: the next tap opens the chat by itself.
                setHelperMissing(false);
                setDirect(true);
              }}
            />
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
