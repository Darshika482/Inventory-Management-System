import React from 'react';
import { Download, Smartphone } from 'lucide-react';
import { useT } from '../i18n';
import { HELPER_APK_URL } from '../share/whatsapp';

/**
 * WhatsApp could not open the customer's chat by itself: the small helper app
 * is not on this phone ('install'), or it is an older one that cannot go
 * through a whole list ('update'). `onDownload`: the next send tries it again.
 */
export function HelperInstallCard({ onDownload, variant = 'install' }: { onDownload: () => void; variant?: 'install' | 'update' }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2.5" data-testid="helper-install">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 border border-amber-200">
          <Smartphone className="h-5 w-5" />
        </span>
        <p className="text-sm leading-snug text-slate-700">
          <span className="block font-bold text-slate-900">{t(variant === 'update' ? 'helperUpdateTitle' : 'helperMissingTitle')}</span>
          {t(variant === 'update' ? 'helperUpdateText' : 'helperMissingText')}
        </p>
      </div>
      <a
        href={HELPER_APK_URL}
        onClick={onDownload}
        className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white border border-amber-200 px-3 text-sm font-bold text-slate-900 hover:border-amber-300"
      >
        <Download className="h-4 w-4" />
        {t('helperDownload')}
      </a>
    </div>
  );
}
