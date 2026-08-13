import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Loader2,
  Maximize2,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useBackDismiss } from '../lib/backGuard';

interface ImageViewerProps {
  open: boolean;
  src: string | null;
  title?: string;
  subtitle?: string;
  /** File name (without extension) used when the photo is downloaded. */
  downloadName?: string;
  onClose: () => void;
  onDownloadFailed?: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function extensionFromUrl(url: string): string {
  try {
    const path = new URL(url, window.location.href).pathname;
    const match = /\.([a-z0-9]{2,5})$/i.exec(decodeURIComponent(path));
    return match ? match[1].toLowerCase() : 'jpg';
  } catch {
    return 'jpg';
  }
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'photo';
}

/** Bakes the on-screen rotation into the file so the download opens the right way up. */
async function rotateBlob(blob: Blob, degrees: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const quarterTurns = ((degrees % 360) + 360) % 360;
    const swapsAxes = quarterTurns === 90 || quarterTurns === 270;

    const canvas = document.createElement('canvas');
    canvas.width = swapsAxes ? bitmap.height : bitmap.width;
    canvas.height = swapsAxes ? bitmap.width : bitmap.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((quarterTurns * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
  } catch {
    return null;
  }
}

export function ImageViewer({
  open,
  src,
  title,
  subtitle,
  downloadName,
  onClose,
  onDownloadFailed,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isDownloading, setIsDownloading] = useState(false);

  // A portrait photo turned on its side is wider than the screen, so it is
  // scaled down to fit. User zoom is applied on top of this.
  const [fitScale, setFitScale] = useState(1);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const gestureRef = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  const lastTapRef = useRef(0);

  // Device / browser Back closes the photo instead of leaving the app.
  useBackDismiss(open, onClose);

  const resetTransform = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!open) return;
    resetTransform();
    setStatus('loading');
    pointersRef.current.clear();
    pinchRef.current = null;
    panRef.current = null;
    lastTapRef.current = 0;
  }, [open, src, resetTransform]);

  // Keep the page behind the viewer still while it is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const recomputeFitScale = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return;

    const quarterTurn = ((rotation % 360) + 360) % 360;
    if (quarterTurn !== 90 && quarterTurn !== 270) {
      setFitScale(1);
      return;
    }

    const { offsetWidth: width, offsetHeight: height } = image;
    if (!width || !height) return;
    setFitScale(Math.min(stage.clientWidth / height, stage.clientHeight / width, 1) || 1);
  }, [rotation]);

  useEffect(() => {
    recomputeFitScale();
  }, [recomputeFitScale, status]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', recomputeFitScale);
    return () => window.removeEventListener('resize', recomputeFitScale);
  }, [open, recomputeFitScale]);

  const clampOffset = useCallback((next: { x: number; y: number }, atScale: number) => {
    if (atScale <= 1) return { x: 0, y: 0 };
    const stage = stageRef.current;
    const width = stage?.clientWidth ?? 0;
    const height = stage?.clientHeight ?? 0;
    const maxX = (width * (atScale - 1)) / 2;
    const maxY = (height * (atScale - 1)) / 2;
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  const zoomTo = useCallback(
    (nextScale: number) => {
      const target = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      setScale(target);
      setOffset((prev) => clampOffset(prev, target));
    },
    [clampOffset]
  );

  const rotateBy = useCallback((degrees: number) => {
    setRotation((prev) => (prev + degrees + 360) % 360);
    setOffset({ x: 0, y: 0 });
    setScale(1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === '+' || event.key === '=') zoomTo(scale + 0.5);
      else if (event.key === '-' || event.key === '_') zoomTo(scale - 0.5);
      else if (event.key === 'r' || event.key === 'R') rotateBy(90);
      else if (event.key === '0') resetTransform();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, zoomTo, rotateBy, resetTransform, scale]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gestureRef.current = { x: event.clientX, y: event.clientY, moved: false };

    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: distanceBetween(first, second), scale };
      panRef.current = null;
    } else {
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (Math.hypot(event.clientX - gestureRef.current.x, event.clientY - gestureRef.current.y) > 10) {
      gestureRef.current.moved = true;
    }

    const pinch = pinchRef.current;
    if (pointersRef.current.size >= 2 && pinch) {
      const [first, second] = Array.from(pointersRef.current.values());
      const nextDistance = distanceBetween(first, second);
      if (pinch.distance > 0) {
        zoomTo((pinch.scale * nextDistance) / pinch.distance);
      }
      return;
    }

    const pan = panRef.current;
    if (pan && scale > 1) {
      setOffset(
        clampOffset(
          { x: pan.offsetX + (event.clientX - pan.x), y: pan.offsetY + (event.clientY - pan.y) },
          scale
        )
      );
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      panRef.current = { x: remaining.x, y: remaining.y, offsetX: offset.x, offsetY: offset.y };
    } else if (pointersRef.current.size === 0) {
      panRef.current = null;
    }

    // Double tap / double click toggles zoom
    if (!gestureRef.current.moved && pointersRef.current.size === 0) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        if (scale > 1) resetZoom();
        else zoomTo(DOUBLE_TAP_SCALE);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    zoomTo(scale - event.deltaY * 0.002 * scale);
  };

  const handleDownload = async () => {
    if (!src) return;
    setIsDownloading(true);
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) throw new Error('Photo could not be fetched');

      let blob = await response.blob();
      let extension = extensionFromUrl(src);

      if (rotation % 360 !== 0) {
        const rotated = await rotateBlob(blob, rotation);
        if (rotated) {
          blob = rotated;
          extension = 'jpg';
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${safeFileName(downloadName || title || 'photo')}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch {
      onDownloadFailed?.();
      window.open(src, '_blank', 'noopener,noreferrer');
    } finally {
      setIsDownloading(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const isTransformed = scale !== 1 || rotation !== 0 || offset.x !== 0 || offset.y !== 0;

  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] bg-slate-950/95 flex flex-col select-none"
          role="dialog"
          aria-modal="true"
          aria-label={title ? `Photo: ${title}` : 'Photo'}
        >
          {/* Top bar */}
          <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-slate-950/90 to-transparent">
            <div className="min-w-0 pt-1">
              {title && (
                <p className="text-base font-bold text-white truncate leading-tight">{title}</p>
              )}
              {subtitle && <p className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close photo"
              className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Image stage */}
          <div
            ref={stageRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center touch-none"
            style={{ cursor: scale > 1 ? 'grab' : 'default' }}
          >
            {status === 'loading' && (
              <div className="absolute flex flex-col items-center gap-3 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                <p className="text-sm font-medium">Loading photo...</p>
              </div>
            )}

            {status === 'error' ? (
              <div className="px-8 text-center space-y-3">
                <p className="text-base font-bold text-white">Could not open this photo</p>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Check your internet connection and try again.
                </p>
              </div>
            ) : (
              <img
                ref={imageRef}
                src={src}
                alt={title ? `Photo of ${title}` : 'Photo'}
                draggable={false}
                onLoad={() => setStatus('ready')}
                onError={() => setStatus('error')}
                className="max-h-full max-w-full object-contain will-change-transform"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale * fitScale}) rotate(${rotation}deg)`,
                  transition:
                    pointersRef.current.size > 0 ? 'none' : 'transform 0.2s ease-out',
                  opacity: status === 'ready' ? 1 : 0,
                }}
              />
            )}
          </div>

          {/* Toolbar */}
          <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-slate-950/90 to-transparent">
            <div className="mx-auto flex w-full max-w-md items-center justify-between gap-1 rounded-2xl bg-white/10 p-1.5 backdrop-blur-sm">
              <ToolbarButton label="Rotate left" onClick={() => rotateBy(-90)}>
                <RotateCcw className="h-5 w-5" />
              </ToolbarButton>
              <ToolbarButton label="Rotate right" onClick={() => rotateBy(90)}>
                <RotateCw className="h-5 w-5" />
              </ToolbarButton>
              <ToolbarButton
                label="Zoom out"
                onClick={() => zoomTo(scale - 0.5)}
                disabled={scale <= MIN_SCALE}
              >
                <ZoomOut className="h-5 w-5" />
              </ToolbarButton>
              <ToolbarButton
                label="Zoom in"
                onClick={() => zoomTo(scale + 0.5)}
                disabled={scale >= MAX_SCALE}
              >
                <ZoomIn className="h-5 w-5" />
              </ToolbarButton>
              <ToolbarButton label="Fit to screen" onClick={resetTransform} disabled={!isTransformed}>
                <Maximize2 className="h-5 w-5" />
              </ToolbarButton>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 px-3 text-sm font-bold text-[#0F172A] transition-colors cursor-pointer disabled:opacity-60"
              >
                {isDownloading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
                Save
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">
              {scale > 1 ? `Zoomed ${Math.round(scale * 100)}% · drag to move around` : 'Pinch or double tap to zoom'}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolbarButton({ label, onClick, disabled = false, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-default"
    >
      {children}
    </button>
  );
}
