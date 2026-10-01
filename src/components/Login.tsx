import React, { useState } from 'react';
import { KeyRound, Shield, User as UserIcon, AlertCircle, Loader2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { usernameExists } from '../lib/database';
import { appVersion, reloadFresh } from '../lib/appUpdate';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
}

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorDetail('');

    // Phone keyboards and password managers like to add spaces.
    const name = username.trim();
    const pass = password.trim();
    if (!name || !pass) {
      setError('Please enter both your name and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await onLogin(name, pass);
      if (!success) {
        // Say which part is wrong, so it is clear what to fix.
        const exists = await usernameExists(name).catch(() => null);
        if (exists === false) {
          setError(`There is no user named "${name}". Check the spelling.`);
        } else {
          setError(
            exists
              ? `The password for "${name}" does not match. Tap the eye to see what is typed, and check the browser did not fill in an old saved password.`
              : 'Wrong name or password. Please try again.'
          );
        }
      }
    } catch (err) {
      const detail = err as { code?: string; message?: string };
      setError('Could not sign in because of a connection or server problem. Please try again.');
      setErrorDetail([detail?.code, detail?.message].filter(Boolean).join(' · ') || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 selection:bg-amber-500 selection:text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.03)_0,transparent_100%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden relative"
      >
        <div className="h-1.5 bg-amber-500 w-full" />

        <div className="p-8 sm:p-10">
          <div className="flex justify-center mb-6">
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex items-center justify-center">
              <Shield className="h-10 w-10 text-amber-600" />
            </div>
          </div>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Akshay Traders
            </h1>
            <p className="text-slate-500 text-base mt-2">
              Sign in to check and update your shop stock
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-base flex items-start gap-3"
              >
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <span>
                  {error}
                  {errorDetail && <span className="block mt-1 text-xs text-red-600/80 break-words">{errorDetail}</span>}
                </span>
              </motion.div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">
                Your name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  placeholder="Type your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  className="block w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 text-base focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-[#0F172A]/10 transition-all disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="current-password"
                  placeholder="Type your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="block w-full pl-12 pr-14 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 text-base focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-[#0F172A]/10 transition-all disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors focus:ring-2 focus:ring-[#0F172A] focus:outline-none flex items-center justify-center gap-2 cursor-pointer shadow-sm text-base mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3 text-xs text-slate-400">
            <span>App version {appVersion()}</span>
            <button
              type="button"
              onClick={() => void reloadFresh()}
              className="min-h-12 flex items-center gap-1.5 px-3 rounded-xl font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              Reload app fresh
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
