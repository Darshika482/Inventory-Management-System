import React, { useEffect, useState } from 'react';
import { Camera, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { isPhotoFillAvailable } from '../lib/extractBill';
import { shrinkImage } from '../lib/imageTools';
import { ImageViewer } from './ImageViewer';

interface PhotoPickerProps {
  label: string;
  file: File | null;
  onSelect: (file: File | null) => void;
  onAutoFill?: () => void;
  isExtracting?: boolean;
  autoFillLabel?: string;
  inputId: string;
}

export function PhotoPicker({
  label,
  file,
  onSelect,
  onAutoFill,
  isExtracting = false,
  autoFillLabel = 'Fill details from photo',
  inputId,
}: PhotoPickerProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const cameraInputId = `${inputId}-camera`;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      setIsPreviewOpen(false);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    e.target.value = '';
    // Camera photos are 8-15 MB; shrink before AI reading / upload
    // so everything stays fast even on slow mobile data.
    onSelect(selected ? await shrinkImage(selected) : null);
  };

  return (
    <div className="space-y-2">
      {!file ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor={cameraInputId}
              className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-xl text-sm font-semibold text-slate-600 bg-slate-50 cursor-pointer transition-colors"
            >
              <Camera className="h-4 w-4 text-amber-600" />
              Take photo
            </label>
            <label
              htmlFor={inputId}
              className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-xl text-sm font-semibold text-slate-600 bg-slate-50 cursor-pointer transition-colors"
            >
              <ImageIcon className="h-4 w-4 text-amber-600" />
              Gallery
            </label>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
          {preview && (
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              aria-label="Open the selected photo"
              className="shrink-0 cursor-pointer"
            >
              <img
                src={preview}
                alt="Selected"
                className="h-14 w-14 rounded-lg object-cover border border-slate-200"
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="flex-1 min-w-0 text-left cursor-pointer"
          >
            <span className="block text-sm text-slate-700 font-semibold truncate">{file.name}</span>
            <span className="block text-xs text-slate-500 mt-0.5">Tap to check the photo</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <input
        id={cameraInputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePick}
      />
      <input id={inputId} type="file" accept="image/*" className="hidden" onChange={handlePick} />

      {file && onAutoFill && isPhotoFillAvailable && (
        <button
          type="button"
          onClick={onAutoFill}
          disabled={isExtracting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-[#0F172A] rounded-xl text-sm font-bold cursor-pointer transition-colors disabled:opacity-60"
        >
          {isExtracting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading the photo...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {autoFillLabel}
            </>
          )}
        </button>
      )}
      {file && onAutoFill && !isPhotoFillAvailable && (
        <p className="text-xs text-slate-500 leading-relaxed px-1">
          The photo will be saved with this entry. Auto-fill from photo is not switched on yet —
          it needs a Gemini AI key to be added to the app settings.
        </p>
      )}

      <ImageViewer
        open={isPreviewOpen}
        src={preview}
        title={file?.name}
        subtitle="Check that the whole bill is clear and readable"
        downloadName={file ? file.name.replace(/\.[^.]+$/, '') : undefined}
        onClose={() => setIsPreviewOpen(false)}
      />
    </div>
  );
}
