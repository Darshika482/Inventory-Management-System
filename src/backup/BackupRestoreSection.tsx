/**
 * Shop settings → "Backup and restore".
 *
 * Connect Telegram once (own bot from @BotFather, then START), then one tap
 * sends every record — udhaar first — to that Telegram chat as a message plus
 * Excel files and a full backup file. Restore puts back, from that full backup
 * file, whatever the app no longer has.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  DatabaseBackup,
  ExternalLink,
  FileUp,
  HardHat,
  KeyRound,
  Loader2,
  Package,
  ReceiptText,
  RotateCcw,
  Send,
  Truck,
  Unplug,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import { FormError, FormInput } from '../components/FormInput';
import { describeDbError } from '../lib/dbErrors';
import { useT, type TranslationKey } from '../sales/i18n';
import { useStore } from '../sales/useStore';
import { ActionButton, ToggleRow } from '../sales/components/ui';
import { BACKUP_TABLES } from './collect';
import { BACKUP_PARTS, type BackupPartId } from './parts';
import { istWhen } from './reports';
import {
  BackupFileError,
  parseBackupFile,
  RestoreSetupMissing,
  restoreBackup,
  type ParsedBackup,
  type TableRestoreResult,
} from './restore';
import { describeTelegramError, isBackupRunning, runBackup, type BackupStep } from './runBackup';
import {
  cleanToken,
  findStartChat,
  getBackupStatus,
  getMe,
  getTelegramConfig,
  newConnectCode,
  saveTelegramConfig,
  sendMessage,
  startLink,
  subscribeBackup,
  TOKEN_PATTERN,
  updateTelegramConfig,
  type BotInfo,
} from './telegram';

type ShowToast = (message: string, type?: 'success' | 'error' | 'info') => void;

const PART_INFO: Record<BackupPartId, { label: TranslationKey; hint: TranslationKey; icon: React.ComponentType<{ className?: string }> }> = {
  udhaar: { label: 'bkPartUdhaar', hint: 'bkPartUdhaarHint', icon: Wallet },
  sales: { label: 'bkPartSales', hint: 'bkPartSalesHint', icon: ReceiptText },
  parties: { label: 'bkPartParties', hint: 'bkPartPartiesHint', icon: Users },
  godown: { label: 'bkPartGodown', hint: 'bkPartGodownHint', icon: Warehouse },
  partyBills: { label: 'bkPartPartyBills', hint: 'bkPartPartyBillsHint', icon: Package },
  transport: { label: 'bkPartTransport', hint: 'bkPartTransportHint', icon: Truck },
  workers: { label: 'bkPartWorkers', hint: 'bkPartWorkersHint', icon: HardHat },
  full: { label: 'bkPartFull', hint: 'bkPartFullHint', icon: DatabaseBackup },
};

const card = 'bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4';

function useBackupStore() {
  return useStore(subscribeBackup, () => ({ config: getTelegramConfig(), status: getBackupStatus() }));
}

export function BackupRestoreSection({ showToast }: { showToast: ShowToast }) {
  const { t } = useT();
  const { config } = useBackupStore();
  return (
    <section className={card} data-testid="backup-restore">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <DatabaseBackup className="h-5 w-5 text-amber-600" />
          {t('bkTitle')}
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">{t('bkIntro')}</p>
      </div>
      {config ? <SendBackupPanel showToast={showToast} /> : <ConnectTelegram showToast={showToast} />}
      <div className="border-t border-slate-100" />
      <RestorePanel showToast={showToast} />
    </section>
  );
}

// --- Connect ---

function StepTitle({ n, children, done = false }: { n: number; children: React.ReactNode; done?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-base font-bold text-slate-900">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-emerald-600 text-white' : 'bg-[#0F172A] text-white'
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      {children}
    </p>
  );
}

function LinkButton({ href, icon, label, onClick, tone = 'secondary' }: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`min-h-12 px-4 flex items-center justify-center gap-2 rounded-xl text-base font-bold transition-colors ${
        tone === 'primary'
          ? 'bg-[#0F172A] hover:bg-slate-800 text-white'
          : 'bg-white border border-slate-200 hover:border-slate-300 text-slate-800'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      <ExternalLink className="h-4 w-4 shrink-0 opacity-60" />
    </a>
  );
}

/** How long to keep looking for the START message after the bot is opened. */
const WAIT_FOR_START_MS = 5 * 60 * 1000;

function ConnectTelegram({ showToast }: { showToast: ShowToast }) {
  const { t } = useT();
  const [token, setToken] = useState('');
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code] = useState(newConnectCode);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [lookingNow, setLookingNow] = useState(false);
  const seq = useRef(0);
  // The automatic check and "I pressed START" can both find it: connect once.
  const connected = useRef(false);

  const checkToken = async () => {
    const clean = cleanToken(token);
    setError(null);
    if (!TOKEN_PATTERN.test(clean)) {
      setError(t('bkTokenInvalid'));
      return;
    }
    setChecking(true);
    try {
      setBot(await getMe(clean));
      setToken(clean);
    } catch (err) {
      setError(describeTelegramError(err, t));
    } finally {
      setChecking(false);
    }
  };

  const connect = async (chatId: string, chatName: string) => {
    if (!bot || connected.current) return;
    connected.current = true;
    const cfg = {
      token,
      chatId,
      chatName,
      botName: bot.first_name,
      botUsername: bot.username,
      parts: [...BACKUP_PARTS],
      autoDaily: true,
    };
    saveTelegramConfig(cfg);
    showToast(t('bkConnected', { chat: chatName }), 'success');
    await sendMessage(cfg, `✅ ${t('bkWelcome')}`).catch(() => undefined);
  };

  /** Looks once for the START message; true when found and connected. */
  const lookForStart = async (): Promise<boolean> => {
    if (!bot) return false;
    try {
      const found = await findStartChat(token, code);
      if (!found) return false;
      seq.current++;
      setWaitingSince(null);
      await connect(found.chatId, found.chatName);
      return true;
    } catch (err) {
      setError(describeTelegramError(err, t));
      return false;
    }
  };

  // While waiting for START: look every few seconds, for a few minutes.
  useEffect(() => {
    if (waitingSince === null) return;
    const mySeq = ++seq.current;
    let timer: number;
    const tick = async () => {
      if (mySeq !== seq.current) return;
      if (Date.now() - waitingSince > WAIT_FOR_START_MS) {
        setWaitingSince(null);
        return;
      }
      const done = await lookForStart();
      if (!done && mySeq === seq.current) timer = window.setTimeout(tick, 2500);
    };
    timer = window.setTimeout(tick, 2500);
    return () => {
      seq.current++;
      window.clearTimeout(timer);
    };
  }, [waitingSince]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkNow = async () => {
    setLookingNow(true);
    setError(null);
    const done = await lookForStart();
    setLookingNow(false);
    if (!done) setError(t('bkStartNotFound'));
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <StepTitle n={1} done={!!bot}>{t('bkStep1')}</StepTitle>
        <p className="text-sm text-slate-600 leading-relaxed">{t('bkStep1Text')}</p>
        {!bot && <LinkButton href="https://t.me/BotFather" icon={<Bot className="h-5 w-5" />} label={t('bkOpenBotFather')} />}
      </div>

      <div className="space-y-2">
        <StepTitle n={2} done={!!bot}>{t('bkStep2')}</StepTitle>
        {bot ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <p className="min-w-0 flex-1 text-sm text-emerald-900">
              {t('bkBotFound')} <span className="font-bold">{bot.first_name}</span> (@{bot.username})
            </p>
            <button
              type="button"
              onClick={() => {
                seq.current++;
                setBot(null);
                setWaitingSince(null);
                setError(null);
              }}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100 cursor-pointer"
              aria-label={t('bkChangeToken')}
              title={t('bkChangeToken')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            <FormInput
              label={t('bkTokenLabel')}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void checkToken();
                }
              }}
              placeholder="123456789:AAH..."
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
            <ActionButton
              icon={<KeyRound className="h-5 w-5" />}
              label={checking ? t('bkChecking') : t('bkCheckToken')}
              busy={checking}
              onClick={() => void checkToken()}
              className="w-full @xl:w-auto"
            />
          </>
        )}
      </div>

      {bot && (
        <div className="space-y-2">
          <StepTitle n={3}>{t('bkStep3')}</StepTitle>
          <p className="text-sm text-slate-600 leading-relaxed">{t('bkStep3Text')}</p>
          <LinkButton
            tone="primary"
            href={startLink(bot.username, code)}
            icon={<Send className="h-5 w-5" />}
            label={t('bkOpenBot', { bot: `@${bot.username}` })}
            onClick={() => setWaitingSince(Date.now())}
          />
          {waitingSince !== null && (
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('bkWaitingStart')}
            </p>
          )}
          <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
            <ActionButton
              tone="secondary"
              icon={<CheckCircle2 className="h-5 w-5" />}
              label={t('bkIPressedStart')}
              busy={lookingNow}
              onClick={() => void checkNow()}
            />
            <LinkButton
              href={startLink(bot.username, code, true)}
              icon={<Users className="h-5 w-5" />}
              label={t('bkUseGroup')}
              onClick={() => setWaitingSince(Date.now())}
            />
          </div>
        </div>
      )}

      {error && <FormError message={error} />}
    </div>
  );
}

// --- Send ---

function stepLabel(step: BackupStep, t: ReturnType<typeof useT>['t']): string {
  if (step.step === 'reading') return t('bkStepReading', { done: step.done, total: step.total });
  if (step.step === 'building') return t('bkStepBuilding');
  return t('bkStepSending', { done: step.done, total: step.total });
}

function SendBackupPanel({ showToast }: { showToast: ShowToast }) {
  const { t } = useT();
  const { config, status } = useBackupStore();
  const [step, setStep] = useState<BackupStep | null>(null);
  const [busy, setBusy] = useState(isBackupRunning);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // The daily backup may be going out right now: show it until it is done.
  useEffect(() => {
    if (!isBackupRunning()) return;
    let live = true;
    runBackup({ t })
      .catch(() => undefined)
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) return null;

  const toggle = (part: BackupPartId) => {
    const parts = config.parts.includes(part) ? config.parts.filter((p) => p !== part) : [...config.parts, part];
    updateTelegramConfig({ parts: BACKUP_PARTS.filter((p) => parts.includes(p)) });
  };

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await runBackup({ t, onStep: setStep });
      showToast(t('bkSent', { chat: config.chatName }), 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const sendTest = async () => {
    setError(null);
    setTesting(true);
    try {
      await sendMessage(config, `👋 ${t('bkTestText')}`);
      showToast(t('bkTestSent'), 'success');
    } catch (err) {
      setError(describeTelegramError(err, t));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
        <div className="min-w-0 text-sm">
          <p className="font-bold text-emerald-900">{t('bkConnectedTitle')}</p>
          <p className="text-emerald-800 break-words">
            {t('bkConnectedTo', { chat: config.chatName, bot: `@${config.botUsername}` })}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm space-y-1">
        <p className="text-slate-700">
          <span className="font-semibold">{t('bkLastBackup')}</span>{' '}
          {status.lastSuccessAt
            ? `${istWhen(new Date(status.lastSuccessAt))}${status.lastWasAuto ? ` · ${t('bkDailyTag')}` : ''}`
            : t('bkNeverSent')}
        </p>
        {status.lastError && (
          <p className="flex items-start gap-1.5 text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {t('bkLastFailed')} {status.lastError}
            </span>
          </p>
        )}
      </div>

      <ActionButton
        size="lg"
        icon={<Send className="h-5 w-5" />}
        label={busy ? (step ? stepLabel(step, t) : t('bkSending')) : t('bkSendNow')}
        busy={busy}
        disabled={config.parts.length === 0}
        onClick={() => void send()}
        className="w-full"
      />
      {error && <FormError message={error} />}

      <ToggleRow
        label={t('bkDaily')}
        hint={t('bkDailyHint')}
        checked={config.autoDaily}
        onChange={(checked) => updateTelegramConfig({ autoDaily: checked })}
      />

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-700">{t('bkWhatToSend')}</p>
        <div className="space-y-1.5">
          {BACKUP_PARTS.map((part) => {
            const info = PART_INFO[part];
            const Icon = info.icon;
            const on = config.parts.includes(part);
            return (
              <button
                key={part}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(part)}
                disabled={busy}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left cursor-pointer transition-colors disabled:cursor-not-allowed ${
                  on ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                    on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {on && <CheckCircle2 className="h-4 w-4" />}
                </span>
                <Icon className="h-5 w-5 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 text-base font-bold text-slate-900">
                    {t(info.label)}
                    {part === 'udhaar' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{t('bkMostImportant')}</span>
                    )}
                  </span>
                  <span className="block text-sm text-slate-500 leading-snug">{t(info.hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
        <ActionButton
          tone="secondary"
          icon={<Send className="h-5 w-5" />}
          label={t('bkSendTest')}
          busy={testing}
          disabled={busy}
          onClick={() => void sendTest()}
        />
        {confirmDisconnect ? (
          <div className="grid grid-cols-2 gap-2">
            <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={() => setConfirmDisconnect(false)} />
            <ActionButton
              tone="danger"
              icon={<Unplug className="h-5 w-5" />}
              label={t('bkDisconnectYes')}
              onClick={() => {
                saveTelegramConfig(null);
                showToast(t('bkDisconnected'), 'info');
              }}
            />
          </div>
        ) : (
          <ActionButton
            tone="secondary"
            icon={<Unplug className="h-5 w-5" />}
            label={t('bkDisconnect')}
            disabled={busy}
            onClick={() => setConfirmDisconnect(true)}
          />
        )}
      </div>
    </div>
  );
}

// --- Restore ---

function RestorePanel({ showToast }: { showToast: ShowToast }) {
  const { t } = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<TableRestoreResult[] | null>(null);

  const pick = async (file: File | undefined) => {
    setError(null);
    setResults(null);
    setBackup(null);
    if (!file) return;
    try {
      setBackup(parseBackupFile(await file.text()));
    } catch (err) {
      const reason = err instanceof BackupFileError ? err.reason : 'notJson';
      setError(
        reason === 'notBackup'
          ? t('bkFileNotBackup')
          : reason === 'newerVersion'
            ? t('bkFileNewer')
            : reason === 'empty'
              ? t('bkFileEmpty')
              : t('bkFileNotJson')
      );
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restore = async () => {
    if (!backup) return;
    setError(null);
    setProgress({ done: 0, total: backup.totalRows });
    try {
      const list = await restoreBackup(backup, (done, total) => setProgress({ done, total }));
      setResults(list);
      setBackup(null);
      const added = list.reduce((s, r) => s + r.added, 0);
      showToast(t('bkRestoreDone', { n: added.toLocaleString('en-IN') }), 'success');
    } catch (err) {
      setError(err instanceof RestoreSetupMissing ? t('bkRestoreSetup') : describeDbError(err, t('bkRestoreError')).message);
    } finally {
      setProgress(null);
    }
  };

  // Records in the file, by part of the business.
  const byPart = new Map<BackupPartId, number>();
  for (const table of backup?.tables ?? []) {
    const part = BACKUP_TABLES.find((b) => b.name === table.name)?.part ?? 'full';
    byPart.set(part, (byPart.get(part) ?? 0) + table.rows.length);
  }

  const added = results?.reduce((s, r) => s + r.added, 0) ?? 0;
  const failed = results?.reduce((s, r) => s + r.failed, 0) ?? 0;
  const inFile = results?.reduce((s, r) => s + r.inFile, 0) ?? 0;
  const firstError = results?.find((r) => r.error)?.error;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <RotateCcw className="h-5 w-5 text-amber-600" />
        {t('bkRestoreTitle')}
      </h3>
      <p className="text-sm text-slate-600 leading-relaxed">{t('bkRestoreText')}</p>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {backup ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm text-slate-800">
            <span className="font-bold">{t('bkRestoreFileOf', { shop: backup.shopName || '—' })}</span>
            {backup.createdAt && <> · {istWhen(new Date(backup.createdAt))}</>}
          </p>
          <ul className="space-y-1 text-sm text-slate-700">
            {BACKUP_PARTS.filter((p) => byPart.has(p)).map((part) => (
              <li key={part} className="flex justify-between gap-3">
                <span>{t(PART_INFO[part].label)}</span>
                <span className="font-semibold tabular-nums">{(byPart.get(part) ?? 0).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600">{t('bkRestoreSafe')}</p>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              tone="secondary"
              icon={<X className="h-5 w-5" />}
              label={t('cancel')}
              disabled={!!progress}
              onClick={() => setBackup(null)}
            />
            <ActionButton
              icon={<RotateCcw className="h-5 w-5" />}
              label={
                progress
                  ? t('bkRestoring', { done: progress.done.toLocaleString('en-IN'), total: progress.total.toLocaleString('en-IN') })
                  : t('bkRestoreButton')
              }
              busy={!!progress}
              onClick={() => void restore()}
            />
          </div>
        </div>
      ) : (
        <ActionButton
          tone="secondary"
          icon={<FileUp className="h-5 w-5" />}
          label={t('bkChooseFile')}
          onClick={() => fileInput.current?.click()}
          className="w-full @xl:w-auto"
        />
      )}

      {results && (
        <div className={`rounded-xl border p-3 text-sm space-y-1 ${failed ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className="font-bold text-slate-900">
            {t('bkRestoreResult', {
              added: added.toLocaleString('en-IN'),
              kept: Math.max(0, inFile - added - failed).toLocaleString('en-IN'),
            })}
          </p>
          {failed > 0 && (
            <p className="text-amber-800">
              {t('bkRestoreFailed', { n: failed.toLocaleString('en-IN') })}
              {firstError && <span className="block text-xs text-amber-700 mt-0.5 break-words">{firstError}</span>}
            </p>
          )}
        </div>
      )}

      {error && <FormError message={error} />}
    </div>
  );
}
