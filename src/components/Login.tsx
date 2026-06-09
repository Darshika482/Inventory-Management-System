import React, { useState } from 'react';
import { KeyRound, Shield, User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
}

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await onLogin(username.trim(), password);
      if (!success) {
        setError('Invalid name or password.');
      }
    } catch {
      setError('Unable to authenticate. Please try again.');
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
        className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden relative"
      >
        <div className="h-1 bg-amber-500 w-full" />

        <div className="p-8 sm:p-10">
          <div className="flex justify-center mb-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-center relative">
              <Shield className="h-8 w-8 text-amber-600" />
            </div>
          </div>

          <div className="text-center mb-8">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-slate-900">
              Akshay traders portal
            </h1>
            <p className="text-slate-500 text-xs mt-1.5 font-medium">
              Role-Based Inventory Control Panel
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-md text-xs flex items-start gap-2.5"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}

            <div className="space-y-1.5">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Enter your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  className="block w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-md text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] transition-all disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="block w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-md text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] transition-all disabled:opacity-60"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white font-semibold uppercase tracking-wider rounded-md transition-colors focus:ring-2 focus:ring-[#0F172A] focus:outline-none flex items-center justify-center gap-2 cursor-pointer shadow-sm text-xs mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Authenticate'
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
