import React, { useState } from 'react';
import { Bluetooth, Eye, Printer, PrinterCheck, Smartphone, Trash2, X } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import {
  bluetoothSupported,
  forgetPrinter,
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
import type { ReceiptLine } from '../print/receipt';
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
  return (
    <div
      className="mx-auto bg-white text-black shadow-md border border-slate-200 px-3 py-4 font-mono text-[12px] leading-snug"
      style={{ width: widthMm === 80 ? 380 : 280, maxWidth: '100%' }}
      data-testid="receipt-paper"
    >
      {lines.map((line, i) => {
        switch (line.kind) {
          case 'rule':
            return <div key={i} className="my-1 border-t border-dashed border-black" />;
          case 'feed':
            return <div key={i} style={{ height: line.lines * 6 }} />;
          case 'qr':
            return (
              <div key={i} className="my-2 text-center">
                <QrSvg data={line.data} />
                <p className="mt-1 text-[11px]">{line.caption}</p>
              </div>
            );
          case 'pair':
            return (
              <div key={i} className={`flex justify-between gap-2 ${line.bold ? 'font-bold' : ''} ${line.big ? 'text-base' : ''}`}>
                <span className="min-w-0 break-words">{line.left}</span>
                <span className="shrink-0 tabular-nums">{line.right}</span>
              </div>
            );
          case 'text':
            return (
              <p
                key={i}
                className={`${line.mono ? 'whitespace-pre' : 'break-words'} ${line.bold ? 'font-bold' : ''} ${line.big ? 'text-lg' : ''} ${
                  line.align === 'center' ? 'text-center' : line.align === 'right' ? 'text-right' : ''
                }`}
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

// --- Printer status chip ---

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  printing: 'bg-amber-500 animate-pulse',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-slate-400',
  not_set_up: 'bg-slate-300',
};

/** Small "Printer ready / Printer off" button; tapping it connects or opens setup. */
export function PrinterChip({ settings }: { settings: ShopSettings | null }) {
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
        <PrinterSetupPanel settings={settings} />
      </AppModal>
    </>
  );
}

// --- Setup (Shop settings and the chip) ---

export function PrinterSetupPanel({ settings }: { settings: ShopSettings | null }) {
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
    if (!bluetoothSupported()) {
      setMessage({ text: t('bluetoothUnsupported'), tone: 'error' });
      return;
    }
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

      {prefs.method === 'bluetooth' && (
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

      {prefs.method !== 'none' && (
        <>
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-slate-700">{t('billNameLabel')}</span>
            <input
              value={prefs.billName}
              onChange={(e) => update({ billName: e.target.value })}
              placeholder="Fall Wholesale"
              className="w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-base text-slate-900 focus:outline-none focus:bg-white focus:border-amber-500"
            />
          </label>
          <ToggleRow label={t('printerUpiQr')} checked={prefs.showUpiQr} onChange={(showUpiQr) => update({ showUpiQr })} />
          <ToggleRow
            label={t('printerNativeQr')}
            hint={t('printerNativeQrHint')}
            checked={prefs.nativeQr}
            onChange={(nativeQr) => update({ nativeQr })}
          />
          <ToggleRow label={t('printerHindi')} hint={t('printerHindiHint')} checked={prefs.hindi} onChange={(hindi) => update({ hindi })} />
          <ToggleRow label={t('printerCutter')} checked={prefs.cutter} onChange={(cutter) => update({ cutter })} />
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
