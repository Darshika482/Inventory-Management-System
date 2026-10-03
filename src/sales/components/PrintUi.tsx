import React, { useEffect, useState } from 'react';
import {
  Bluetooth,
  BluetoothOff,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  Eye,
  Printer,
  PrinterCheck,
  RefreshCw,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import { useStore } from '../useStore';
import {
  bluetoothSupported,
  forgetPrinter,
  printerRemembered,
  restorePrinter,
  getPrinterPrefs,
  pairBluetoothPrinter,
  savePrinterPrefs,
  usePrinterStatus,
  type PrinterPrefs,
  type PrintMethod,
  type PrintResult,
} from '../print/printer';
import { printTestPage } from '../print/printBill';
import { qrMatrix } from '../print/qr';
import { charsPerLine, type ReceiptLine } from '../print/receipt';
import type { ShopSettings } from '../types';
import { ActionButton, Segmented, ToggleRow } from './ui';

// --- Preview ---

export function QrSvg({ data, className = 'mx-auto h-36 w-36' }: { data: string; className?: string }) {
  const matrix = qrMatrix(data);
  const size = matrix.length;
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className={className} shapeRendering="crispEdges" aria-hidden="true">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      {matrix.flatMap((row, r) => row.map((dark, c) => (dark ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null)))}
    </svg>
  );
}

/** The bill drawn like the paper roll, from the same lines the printer gets. */
export function ReceiptPaper({ lines, widthMm }: { lines: ReceiptLine[]; widthMm: 58 | 80 }) {
  // Size the letters so a full row fits, like on the paper: the small font
  // (items, totals) fits more letters per line than the normal one.
  const paper = widthMm === 80 ? 380 : 280;
  const sizeFor = (chars: number) => Math.min(12, Math.floor(((paper - 24) / (chars * 0.6)) * 10) / 10);
  const fontSize = sizeFor(charsPerLine(widthMm));
  const smallSize = sizeFor(charsPerLine(widthMm, true));
  const robotoMono = getPrinterPrefs().robotoMono;
  return (
    <div
      className={`mx-auto bg-white text-black shadow-md border border-slate-200 px-3 py-4 font-mono leading-snug ${robotoMono ? 'font-medium' : ''}`}
      style={{ width: paper, maxWidth: '100%', fontSize, fontFamily: robotoMono ? '"Roboto Mono", ui-monospace, monospace' : undefined }}
      data-testid="receipt-paper"
    >
      {lines.map((line, i) => {
        switch (line.kind) {
          case 'rule':
            return <div key={i} className="my-1 border-t border-dashed border-black" />;
          case 'feed':
            return <div key={i} style={{ height: line.lines * 6 }} />;
          case 'qr': {
            const side = line.side ?? [];
            const picture = getPrinterPrefs().qrStyle === 'picture';
            return (
              <div key={i} className="my-2">
                {/* Same share of the paper as on the printout: small picture ~1/3, blocks ~3/4. */}
                <div className={`flex items-center gap-3 ${side.length ? 'justify-start' : 'justify-center'}`}>
                  <div className="shrink-0" style={{ width: `${picture ? 34 : 74}%` }}>
                    <QrSvg data={line.data} className="w-full h-auto" />
                  </div>
                  {side.length > 0 && (
                    <div className={`min-w-0 space-y-2 ${robotoMono ? '' : 'font-sans'}`}>
                      {side.map((item) => (
                        <div key={item.label}>
                          <p className="text-[10px] font-semibold leading-tight">{item.label}</p>
                          <p className={`text-[13px] leading-tight tabular-nums ${item.strong ? 'font-extrabold' : robotoMono ? '' : 'font-bold'}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {line.caption && <p className="mt-1 text-center text-[11px]">{line.caption}</p>}
              </div>
            );
          }
          case 'pair':
            return (
              <div
                key={i}
                className={`flex justify-between gap-2 ${line.bold ? 'font-bold' : ''} ${line.big ? 'text-base' : ''}`}
                style={line.small ? { fontSize: smallSize } : undefined}
              >
                <span className="min-w-0 break-words">{line.left}</span>
                <span className="shrink-0 tabular-nums">{line.right}</span>
              </div>
            );
          case 'text':
            return (
              <p
                key={i}
                className={`${line.mono ? 'whitespace-pre' : 'break-words'} ${line.bold ? 'font-bold' : ''} ${line.big ? 'text-lg' : ''} ${line.tall ? 'text-base' : ''} ${
                  line.align === 'center' ? 'text-center' : line.align === 'right' ? 'text-right' : ''
                }`}
                style={line.small ? { fontSize: smallSize } : undefined}
              >
                {line.text}
              </p>
            );
        }
      })}
    </div>
  );
}

interface ReceiptPreviewModalProps {
  open: boolean;
  lines: ReceiptLine[];
  widthMm: 58 | 80;
  onClose: () => void;
  onPrint: () => void;
  busy?: boolean;
}

export function ReceiptPreviewModal({ open, lines, widthMm, onClose, onPrint, busy }: ReceiptPreviewModalProps) {
  const { t } = useT();
  return (
    <AppModal open={open} onClose={onClose} title={t('previewTitle')} icon={<Eye className="h-5 w-5" />} accent="slate">
      <div className="space-y-4">
        <div className="bg-slate-100 rounded-xl p-3">
          <ReceiptPaper lines={lines} widthMm={widthMm} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('close')} onClick={onClose} />
          <ActionButton tone="success" icon={<Printer className="h-5 w-5" />} label={t('print')} onClick={onPrint} busy={busy} />
        </div>
      </div>
    </AppModal>
  );
}

// --- Result of a print ---

export function printMessageKey(result: PrintResult) {
  if (!('reason' in result)) return 'printed' as const;
  if (result.reason === 'not_set_up') return 'printNotSetUp' as const;
  if (result.reason === 'not_connected') return 'printNotConnected' as const;
  return 'printFailed' as const;
}

export function printDetail(result: PrintResult): string {
  return 'detail' in result && result.detail ? result.detail : '';
}

// --- Printer help: connect the printer and print again ---

interface HelpRequest {
  /** The print that failed, to explain what went wrong. */
  result?: PrintResult;
  /** Prints the bill again once the printer is connected. */
  retry?: () => Promise<PrintResult>;
}

let helpRequest: HelpRequest | null = null;
const helpListeners = new Set<() => void>();

/** Opens the printer help sheet (one at a time; a second call while open is ignored). */
export function openPrinterHelp(request: HelpRequest): void {
  if (helpRequest) return;
  helpRequest = request;
  helpListeners.forEach((l) => l());
}

function closePrinterHelp() {
  helpRequest = null;
  helpListeners.forEach((l) => l());
}

/**
 * Print again from a tap: opens the phone's printer list straight away (Chrome
 * only allows that right after a tap), then prints. When that is not possible,
 * or the printer is not picked, the help sheet opens instead.
 */
export function connectAndPrint(print: () => Promise<PrintResult>): Promise<PrintResult> {
  const prefs = getPrinterPrefs();
  if (prefs.method === 'rawbt') return print();
  if (!bluetoothSupported()) {
    const result: PrintResult = { ok: false, reason: 'not_connected' };
    openPrinterHelp({ result, retry: print });
    return Promise.resolve(result);
  }
  return pairBluetoothPrinter().then((picked) => {
    if (picked.ok) return print();
    const result: PrintResult = { ok: false, reason: 'not_connected' };
    openPrinterHelp({ result, retry: print });
    return result;
  });
}

type Browser = 'brave' | 'ios' | 'other';

function blockedBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'other';
  if ('brave' in navigator) return 'brave';
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return 'ios';
  return 'other';
}

const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const BRAVE_FLAG = 'brave://flags/#brave-web-bluetooth-api';

/** An address to copy (chrome:// pages cannot be opened by a link). */
function CopyLine({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-sm text-slate-800">{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // Clipboard blocked: the address is on screen to type.
          }
        }}
        className="shrink-0 min-h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700 cursor-pointer flex items-center gap-1.5"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}

const CHROME_FLAGS = [
  'chrome://flags/#enable-web-bluetooth-new-permissions-backend',
  'chrome://flags/#enable-experimental-web-platform-features',
];

/**
 * Chrome forgets the printer whenever the app reloads (after a refresh or an
 * update) unless two of its settings are on. One-time steps per phone.
 */
export function KeepPrinterTip() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (printerRemembered() || !isAndroid()) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5" data-testid="keep-printer-tip">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex gap-3 text-left cursor-pointer">
        <RefreshCw className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
        <span className="min-w-0">
          <span className="block text-base font-bold text-slate-900">{t('keepPrinterTitle')}</span>
          <span className="block text-sm text-slate-700 leading-relaxed">{t('keepPrinterText')}</span>
          {!open && <span className="block text-sm font-bold text-amber-800 underline underline-offset-4 mt-1">{t('keepPrinterShow')}</span>}
        </span>
      </button>
      {open && (
        <ol className="space-y-2.5 text-sm text-slate-800">
          <li>
            <p className="mb-1.5">{t('keepPrinterStep1')}</p>
            <CopyLine value={CHROME_FLAGS[0]} />
          </li>
          <li>
            <p className="mb-1.5">{t('keepPrinterStep2')}</p>
            <CopyLine value={CHROME_FLAGS[1]} />
          </li>
          <li>{t('keepPrinterStep3')}</li>
        </ol>
      )}
    </div>
  );
}

/** Why the printer list cannot open in this browser, and the ways around it. */
export function BluetoothBlockedHelp({ onUseRawBt }: { onUseRawBt?: () => void }) {
  const { t } = useT();
  const browser = blockedBrowser();
  const [copied, setCopied] = useState(false);

  const openInChrome = () => {
    const { host, pathname, search } = window.location;
    window.location.href = `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;end`;
  };

  const copyFlag = async () => {
    try {
      await navigator.clipboard.writeText(BRAVE_FLAG);
      setCopied(true);
    } catch {
      // Clipboard blocked: the address is on screen to type.
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-xl bg-amber-50 border border-amber-200 p-3.5">
        <BluetoothOff className="h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <p className="text-base font-bold text-slate-900">{t('btBlockedTitle')}</p>
          <p className="text-sm text-slate-700 leading-relaxed mt-0.5">
            {t(browser === 'brave' ? 'btBlockedBrave' : browser === 'ios' ? 'btBlockedIos' : 'btBlockedOther')}
          </p>
        </div>
      </div>

      {isAndroid() && (
        <HelpOption number={1} title={t('btOpenChromeTitle')} text={t('btOpenChromeText')}>
          <ActionButton icon={<ExternalLink className="h-5 w-5" />} label={t('btOpenChrome')} onClick={openInChrome} className="w-full" />
        </HelpOption>
      )}

      {browser === 'brave' && (
        <HelpOption number={isAndroid() ? 2 : 1} title={t('btBraveFlagTitle')} text={t('btBraveFlagText')}>
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-sm text-slate-800">{BRAVE_FLAG}</code>
            <button
              type="button"
              onClick={copyFlag}
              className="shrink-0 min-h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700 cursor-pointer flex items-center gap-1.5"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
        </HelpOption>
      )}

      {onUseRawBt && isAndroid() && (
        <HelpOption number={browser === 'brave' ? 3 : 2} title={t('btRawBtTitle')} text={t('btRawBtText')}>
          <ActionButton tone="secondary" icon={<Smartphone className="h-5 w-5" />} label={t('btUseRawBt')} onClick={onUseRawBt} className="w-full" />
        </HelpOption>
      )}
    </div>
  );
}

function HelpOption({ number, title, text, children }: { number: number; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
      <div className="flex gap-3">
        <span className="h-7 w-7 shrink-0 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center">{number}</span>
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900">{title}</p>
          <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Things to check when the printer does not show up or does not print. */
function PrinterChecklist({ rawbt }: { rawbt: boolean }) {
  const { t } = useT();
  const items = rawbt
    ? (['checkRawBtInstalled', 'checkRawBtPrinter', 'checkPrinterOn'] as const)
    : (['checkPrinterOn', 'checkOnePhone', 'checkPhoneBluetooth', 'checkOtherApps'] as const);
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
      <p className="text-sm font-bold text-slate-800 mb-2">{t('checkTitle')}</p>
      <ul className="space-y-1.5">
        {items.map((key) => (
          <li key={key} className="flex gap-2 text-sm text-slate-700 leading-relaxed">
            <CircleCheck className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The help sheet; mounted once for the shop pages. */
export function PrinterHelpHost({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  // After a refresh or an app update, pick the saved printer back up if Chrome allows it.
  useEffect(() => {
    void restorePrinter();
  }, []);
  const request = useStore(
    (l) => {
      helpListeners.add(l);
      return () => helpListeners.delete(l);
    },
    () => helpRequest
  );
  // Keep the last request on screen while the sheet slides away.
  const [shown, setShown] = useState<HelpRequest | null>(request);
  if (request && request !== shown) setShown(request);

  return (
    <AppModal
      open={Boolean(request)}
      onClose={closePrinterHelp}
      title={t('printerHelpTitle')}
      description={t('printerHelpSubtitle')}
      icon={<Printer className="h-5 w-5" />}
      accent="amber"
    >
      {shown && <PrinterConnectFlow key={String(Boolean(request))} request={shown} canEdit={canEdit} onDone={closePrinterHelp} />}
    </AppModal>
  );
}

function PrinterConnectFlow({ request, canEdit, onDone }: { request: HelpRequest; canEdit: boolean; onDone: () => void }) {
  const { t } = useT();
  const status = usePrinterStatus();
  const [prefs, setPrefs] = useState<PrinterPrefs>(getPrinterPrefs);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'printing' | 'done'>('idle');
  const [error, setError] = useState<string | null>(() =>
    request.result && !request.result.ok ? [t(printMessageKey(request.result)), printDetail(request.result)].filter(Boolean).join(' ') : null
  );

  const runPrint = async () => {
    if (!request.retry) {
      setPhase('done');
      setTimeout(onDone, 900);
      return;
    }
    setPhase('printing');
    const result = await request.retry();
    if (result.ok) {
      setPhase('done');
      setTimeout(onDone, 900);
    } else {
      setPhase('idle');
      setError([t(printMessageKey(result)), printDetail(result)].filter(Boolean).join(' '));
    }
  };

  const connect = async () => {
    setError(null);
    setPhase('connecting');
    // First thing after the tap, so Chrome lets the printer list open.
    const picked = await pairBluetoothPrinter();
    setPrefs(getPrinterPrefs());
    if (picked.ok) return runPrint();
    setPhase('idle');
    if (picked.message === 'cancelled') setError(t('printerNotPicked'));
    else if (picked.message !== 'bluetooth_unsupported') setError(picked.message);
  };

  const useRawBt = () => {
    const next = { ...getPrinterPrefs(), method: 'rawbt' as const };
    savePrinterPrefs(next);
    setPrefs(next);
    setError(null);
  };

  const rawbt = prefs.method === 'rawbt';
  const blocked = !rawbt && !bluetoothSupported();
  const busy = phase !== 'idle';

  if (phase === 'done') {
    return (
      <div className="py-6 text-center space-y-2">
        <CircleCheck className="h-14 w-14 mx-auto text-emerald-600" />
        <p className="text-lg font-bold text-slate-900">{request.retry ? t('printed') : t('printerReady')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && !blocked && (
        <p role="alert" className="flex gap-2 rounded-xl bg-red-50 border border-red-100 px-3.5 py-3 text-sm font-semibold text-red-700">
          <TriangleAlert className="h-5 w-5 shrink-0" />
          {error}
        </p>
      )}

      {blocked ? (
        <BluetoothBlockedHelp onUseRawBt={canEdit ? useRawBt : undefined} />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3.5">
            <span className="h-11 w-11 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center">
              {rawbt ? <Smartphone className="h-5 w-5 text-slate-700" /> : <Bluetooth className="h-5 w-5 text-slate-700" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-900 truncate">
                {rawbt ? t('printer_rawbt') : prefs.deviceName || t('printerNoneYet')}
              </p>
              <p className="text-sm text-slate-500 flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${DOT[status.state]}`} />
                {phase === 'connecting' ? t('printerStatus_connecting') : phase === 'printing' ? t('printing') : t(`printerStatus_${status.state}`)}
              </p>
            </div>
          </div>

          {rawbt ? (
            <ActionButton
              size="lg"
              tone="success"
              icon={<Printer className="h-5 w-5" />}
              label={request.retry ? t('retryPrint') : t('close')}
              busy={busy}
              onClick={runPrint}
              className="w-full"
            />
          ) : (
            <div className="space-y-2">
              <ActionButton
                size="lg"
                tone="success"
                icon={<Bluetooth className="h-5 w-5" />}
                label={request.retry ? t('connectAndPrint') : t('connectPrinter')}
                busy={busy}
                onClick={connect}
                className="w-full"
              />
              <p className="text-xs text-slate-500 text-center">{t('connectAndPrintHint')}</p>
            </div>
          )}

          <PrinterChecklist rawbt={rawbt} />

          {!rawbt && <KeepPrinterTip />}

          {canEdit && !rawbt && isAndroid() && (
            <button type="button" onClick={useRawBt} className="w-full min-h-11 text-sm font-bold text-slate-600 underline underline-offset-4 cursor-pointer">
              {t('btUseRawBtInstead')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// --- Printer status chip ---

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  printing: 'bg-amber-500 animate-pulse',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-slate-400',
  not_set_up: 'bg-slate-300',
};

/** Small "Printer ready / Printer off" button; tapping it connects or opens setup. */
export function PrinterChip({ settings, canEdit }: { settings: ShopSettings | null; canEdit: boolean }) {
  const { t } = useT();
  const status = usePrinterStatus();
  const [setupOpen, setSetupOpen] = useState(false);

  const onTap = async () => {
    if (status.method === 'bluetooth' && status.state === 'disconnected') {
      const result = await pairBluetoothPrinter();
      if (result.ok) return;
    }
    setSetupOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onTap}
        className="min-h-12 flex items-center gap-2 px-3.5 bg-white border border-slate-200 hover:border-amber-300 text-slate-700 rounded-xl text-sm font-bold cursor-pointer transition-colors shrink-0"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${DOT[status.state]}`} aria-hidden="true" />
        <Printer className="h-5 w-5 text-slate-500" />
        <span className="hidden @md:inline">{t(`printerStatus_${status.state}`)}</span>
      </button>
      <AppModal open={setupOpen} onClose={() => setSetupOpen(false)} title={t('printerTitle')} icon={<Printer className="h-5 w-5" />} accent="slate">
        <PrinterSetupPanel settings={settings} canEdit={canEdit} />
      </AppModal>
    </>
  );
}

// --- Setup (Shop settings and the chip) ---

/** Staff (canEdit false) only get connect and test; the print options are the owner's. */
export function PrinterSetupPanel({ settings, canEdit = true }: { settings: ShopSettings | null; canEdit?: boolean }) {
  const { t } = useT();
  const status = usePrinterStatus();
  const [prefs, setPrefs] = useState<PrinterPrefs>(getPrinterPrefs);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<PrinterPrefs>) => {
    const next = { ...getPrinterPrefs(), ...patch };
    savePrinterPrefs(next);
    setPrefs(next);
  };

  const connect = async () => {
    setMessage(null);
    setBusy(true);
    const result = await pairBluetoothPrinter();
    setBusy(false);
    setPrefs(getPrinterPrefs());
    if (result.ok) setMessage({ text: t('printerConnected', { name: result.message }), tone: 'ok' });
    else if (result.message === 'bluetooth_unsupported') setMessage({ text: t('bluetoothUnsupported'), tone: 'error' });
    else if (result.message !== 'cancelled') setMessage({ text: result.message, tone: 'error' });
  };

  const test = async () => {
    if (!settings) return;
    setMessage(null);
    setBusy(true);
    const result = await printTestPage(settings);
    setBusy(false);
    setMessage(
      result.ok
        ? { text: t('testPrintSent'), tone: 'ok' }
        : { text: [t(printMessageKey(result)), printDetail(result)].filter(Boolean).join(' '), tone: 'error' }
    );
  };

  const statusText =
    prefs.method === 'bluetooth'
      ? prefs.deviceName
        ? t(status.state === 'connected' ? 'printerConnected' : 'printerNotConnected', { name: prefs.deviceName })
        : t('printerNoneYet')
      : null;

  return (
    <div className="space-y-4">
      {canEdit && (
        <>
        <Segmented<PrintMethod>
          label={t('printerMethod')}
          value={prefs.method}
          columns={3}
          options={[
            { value: 'bluetooth', label: t('printer_bluetooth'), icon: <Bluetooth className="h-4 w-4" /> },
            { value: 'rawbt', label: t('printer_rawbt'), icon: <Smartphone className="h-4 w-4" /> },
            { value: 'none', label: t('printer_none'), icon: <X className="h-4 w-4" /> },
          ]}
          onChange={(method) => update({ method })}
        />
        <p className="text-sm text-slate-500 leading-relaxed -mt-2">{t('printerMethodHint')}</p>
        </>
      )}

      {prefs.method === 'bluetooth' && !bluetoothSupported() && (
        <BluetoothBlockedHelp onUseRawBt={canEdit ? () => update({ method: 'rawbt' }) : undefined} />
      )}

      {prefs.method === 'bluetooth' && bluetoothSupported() && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          {statusText && (
            <p className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <span className={`h-2.5 w-2.5 rounded-full ${DOT[status.state]}`} />
              {statusText}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ActionButton icon={<Bluetooth className="h-5 w-5" />} label={t('connectPrinter')} onClick={connect} busy={busy} />
            {prefs.deviceName && (
              <ActionButton
                tone="secondary"
                icon={<Trash2 className="h-5 w-5" />}
                label={t('forgetPrinter')}
                onClick={() => {
                  forgetPrinter();
                  setPrefs(getPrinterPrefs());
                }}
              />
            )}
          </div>
        </div>
      )}

      {prefs.method === 'bluetooth' && bluetoothSupported() && <KeepPrinterTip />}

      {prefs.method !== 'none' && (
        <>
          {canEdit && (
            <>
              <label className="block space-y-1.5">
                <span className="block text-sm font-semibold text-slate-700">{t('billNameLabel')}</span>
                <input
                  value={prefs.billName}
                  onChange={(e) => update({ billName: e.target.value })}
                  placeholder="Surbhi Fall"
                  className="w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-base text-slate-900 focus:outline-none focus:bg-white focus:border-amber-500"
                />
                <input
                  value={prefs.billSubtitle}
                  onChange={(e) => update({ billSubtitle: e.target.value })}
                  placeholder="wholesale"
                  className="w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-base text-slate-900 focus:outline-none focus:bg-white focus:border-amber-500"
                />
              </label>
              <ToggleRow label={t('printerUpiQr')} checked={prefs.showUpiQr} onChange={(showUpiQr) => update({ showUpiQr })} />
              <ToggleRow label={t('printerRobotoMono')} hint={t('printerRobotoMonoHint')} checked={prefs.robotoMono} onChange={(robotoMono) => update({ robotoMono })} />
              <ToggleRow label={t('printerHindi')} hint={t('printerHindiHint')} checked={prefs.hindi} onChange={(hindi) => update({ hindi })} />
              <ToggleRow label={t('printerCutter')} checked={prefs.cutter} onChange={(cutter) => update({ cutter })} />
            </>
          )}
          <ActionButton
            tone="success"
            icon={<PrinterCheck className="h-5 w-5" />}
            label={t('testPrint')}
            onClick={test}
            busy={busy}
            disabled={!settings}
            className="w-full"
          />
        </>
      )}

      {message && (
        <p
          role="status"
          className={`rounded-xl px-3.5 py-3 text-sm font-semibold ${
            message.tone === 'ok' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      )}
      <p className="text-xs text-slate-400">{t('printerPrefsHint')}</p>
    </div>
  );
}
