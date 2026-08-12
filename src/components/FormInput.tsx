import React from 'react';

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  accent?: 'amber' | 'emerald' | 'slate';
}

const focusRing: Record<NonNullable<FormInputProps['accent']>, string> = {
  amber: 'focus:border-amber-500 focus:ring-amber-500/15',
  emerald: 'focus:border-emerald-500 focus:ring-emerald-500/15',
  slate: 'focus:border-[#0F172A] focus:ring-[#0F172A]/10',
};

export function FormInput({ label, accent = 'amber', className = '', ...props }: FormInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-slate-700">{label}</label>
      <input
        {...props}
        className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-4 transition-all ${focusRing[accent]} ${className}`}
      />
    </div>
  );
}

interface FormErrorProps {
  message: string;
  /** Technical line worth passing on to a developer, shown quietly under the message. */
  detail?: string;
}

export function FormError({ message, detail }: FormErrorProps) {
  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-200 text-red-700 p-3.5 text-sm rounded-xl leading-relaxed"
    >
      {message}
      {detail && (
        <p className="mt-2 pt-2 border-t border-red-200/70 text-xs text-red-600/90 break-words">
          {detail}
        </p>
      )}
    </div>
  );
}

interface ModalActionsProps {
  onCancel: () => void;
  submitLabel: string;
  cancelLabel?: string;
  submitType?: 'button' | 'submit';
  onSubmit?: () => void;
  isSubmitting?: boolean;
  submitAccent?: 'amber' | 'emerald' | 'red' | 'slate';
}

const submitStyles: Record<NonNullable<ModalActionsProps['submitAccent']>, string> = {
  amber: 'bg-[#0F172A] hover:bg-slate-800 text-white',
  emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  red: 'bg-red-600 hover:bg-red-700 text-white',
  slate: 'bg-[#0F172A] hover:bg-slate-800 text-white',
};

export function ModalActions({
  onCancel,
  submitLabel,
  cancelLabel = 'Cancel',
  submitType = 'submit',
  onSubmit,
  isSubmitting = false,
  submitAccent = 'amber',
}: ModalActionsProps) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-5 mt-2 border-t border-slate-100">
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="w-full sm:w-auto px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-60"
      >
        {cancelLabel}
      </button>
      <button
        type={submitType}
        onClick={onSubmit}
        disabled={isSubmitting}
        className={`w-full sm:w-auto px-5 py-3.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-60 ${submitStyles[submitAccent]}`}
      >
        {isSubmitting ? 'Saving...' : submitLabel}
      </button>
    </div>
  );
}
