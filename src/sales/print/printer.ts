/**
 * Talking to the thermal printer from the browser.
 *
 * - Bluetooth (BLE) printers: Web Bluetooth, Chrome on Android.
 * - Classic Bluetooth printers (most cheap shop printers): the free RawBT app
 *   on Android does the printing; the app hands it the ESC/POS bytes.
 *
 * Printer choices are per phone (localStorage). Printing never affects saving:
 * every function here reports failure instead of throwing at the caller.
 */
import { useStore } from '../useStore';

export type PrintMethod = 'bluetooth' | 'rawbt' | 'none';

export interface PrinterPrefs {
  method: PrintMethod;
  deviceId: string;
  deviceName: string;
  /** Printer has an automatic paper cutter. */
  cutter: boolean;
  /** Printer can draw QR codes itself (GS ( k). Off = QR sent as an image. */
  nativeQr: boolean;
  /** Item names in Hindi (receipt is sent as an image). */
  hindi: boolean;
  /** UPI QR for the amount due. */
  showUpiQr: boolean;
}

const PREFS_KEY = 'shop_printer';
const DEFAULT_PREFS: PrinterPrefs = {
  method: 'none',
  deviceId: '',
  deviceName: '',
  cutter: false,
  nativeQr: true,
  hindi: false,
  showUpiQr: true,
};

export function getPrinterPrefs(): PrinterPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrinterPrefs(prefs: PrinterPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: choices last until the page reloads.
  }
  const state: PrinterState =
    prefs.method === 'none'
      ? 'not_set_up'
      : prefs.method === 'rawbt'
        ? 'connected'
        : channel
          ? 'connected'
          : 'disconnected';
  status = { method: prefs.method, deviceName: prefs.deviceName, state };
  emit();
}

export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

// --- Status for the little printer dot ---

export type PrinterState = 'not_set_up' | 'disconnected' | 'connecting' | 'connected' | 'printing';

interface PrinterStatus {
  method: PrintMethod;
  state: PrinterState;
  deviceName: string;
}

let status: PrinterStatus = (() => {
  const prefs = getPrinterPrefs();
  return {
    method: prefs.method,
    deviceName: prefs.deviceName,
    // RawBT is always "ready": the RawBT app keeps the connection.
    state: prefs.method === 'none' ? 'not_set_up' : prefs.method === 'rawbt' ? 'connected' : 'disconnected',
  };
})();
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function setState(state: PrinterState) {
  status = { ...status, state };
  emit();
}

export function usePrinterStatus(): PrinterStatus {
  return useStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status
  );
}

// --- Bluetooth ---

/** Service / characteristic pairs used by common ESC/POS BLE printers. */
const KNOWN = [
  { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', characteristic: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', characteristic: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
  { service: '0000ae30-0000-1000-8000-00805f9b34fb', characteristic: '0000ae01-0000-1000-8000-00805f9b34fb' },
];

let device: BluetoothDevice | null = null;
let channel: BluetoothRemoteGATTCharacteristic | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function findWritable(server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
  for (const known of KNOWN) {
    try {
      const service = await server.getPrimaryService(known.service);
      try {
        return await service.getCharacteristic(known.characteristic);
      } catch {
        const chars = await service.getCharacteristics();
        const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        if (writable) return writable;
      }
    } catch {
      // Not this printer's service; try the next.
    }
  }
  throw new Error('This Bluetooth device does not look like a receipt printer.');
}

async function connect(target: BluetoothDevice): Promise<void> {
  if (!target.gatt) throw new Error('This device cannot be connected.');
  setState('connecting');
  const server = await target.gatt.connect();
  channel = await findWritable(server);
  device = target;
  setState('connected');
}

function onDisconnected() {
  channel = null;
  if (status.method === 'bluetooth') setState('disconnected');
}

/** Opens the phone's Bluetooth chooser (needs a tap) and remembers the printer. */
export async function pairBluetoothPrinter(): Promise<{ ok: boolean; message: string }> {
  if (!navigator.bluetooth) {
    return { ok: false, message: 'bluetooth_unsupported' };
  }
  try {
    const picked = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN.map((k) => k.service),
    });
    picked.addEventListener('gattserverdisconnected', onDisconnected);
    await connect(picked);
    savePrinterPrefs({ ...getPrinterPrefs(), method: 'bluetooth', deviceId: picked.id, deviceName: picked.name ?? 'Printer' });
    return { ok: true, message: picked.name ?? 'Printer' };
  } catch (err) {
    setState(status.method === 'bluetooth' ? 'disconnected' : status.state);
    const message = err instanceof Error ? err.message : String(err);
    // Closing the chooser is not an error worth showing.
    return { ok: false, message: /cancel/i.test(message) ? 'cancelled' : message };
  }
}

/** Connected already, or reconnects to the saved printer within `ms`. */
async function ensureConnected(ms: number): Promise<boolean> {
  if (channel && device?.gatt?.connected) return true;
  try {
    let target = device;
    if (!target && navigator.bluetooth?.getDevices) {
      const known = await navigator.bluetooth.getDevices();
      target = known.find((d) => d.id === getPrinterPrefs().deviceId) ?? null;
      target?.addEventListener('gattserverdisconnected', onDisconnected);
    }
    if (!target) return false;
    await withTimeout(connect(target), ms);
    return true;
  } catch {
    setState('disconnected');
    return false;
  }
}

/** Tries to reconnect in the background (e.g. when the bill screen opens). */
export function warmUpPrinter(): void {
  if (getPrinterPrefs().method === 'bluetooth' && status.state !== 'connected') void ensureConnected(5000);
}

async function writeBluetooth(bytes: Uint8Array): Promise<void> {
  if (!channel) throw new Error('not connected');
  const fast = channel.properties.writeWithoutResponse && channel.writeValueWithoutResponse;
  const chunk = 100;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk);
    if (fast) await channel.writeValueWithoutResponse!(part);
    else await channel.writeValue(part);
  }
}

// --- RawBT ---

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sendToRawBt(bytes: Uint8Array) {
  window.location.href = `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// --- Printing ---

export type PrintResult =
  | { ok: true }
  | { ok: false; reason: 'not_set_up' | 'not_connected' | 'failed'; detail?: string };

/** Sends bytes to the printer. Never throws. */
export async function printBytes(bytes: Uint8Array): Promise<PrintResult> {
  const prefs = getPrinterPrefs();
  if (prefs.method === 'none') return { ok: false, reason: 'not_set_up' };

  if (prefs.method === 'rawbt') {
    try {
      sendToRawBt(bytes);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!(await ensureConnected(5000))) return { ok: false, reason: 'not_connected' };
  setState('printing');
  try {
    await writeBluetooth(bytes);
    setState('connected');
    return { ok: true };
  } catch (err) {
    setState(device?.gatt?.connected ? 'connected' : 'disconnected');
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

export function forgetPrinter(): void {
  try {
    device?.gatt?.disconnect();
  } catch {
    // Already gone.
  }
  device = null;
  channel = null;
  savePrinterPrefs({ ...getPrinterPrefs(), method: 'none', deviceId: '', deviceName: '' });
  setState('not_set_up');
}
