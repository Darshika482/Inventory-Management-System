/**
 * Phone keyboard comfort for the shop screens.
 *
 * Android's number keyboard has a ✓ / Done key that, in a web page, does not
 * close the keyboard by itself; people had to press Back. Here every number
 * box (inputmode numeric / decimal / tel) gets a "Done" key, and pressing it
 * closes the keyboard. A number box inside a form no longer submits the form
 * by accident either.
 */
import { useEffect, useState } from 'react';

const NUMBER_MODES = new Set(['numeric', 'decimal', 'tel']);

function isNumberBox(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (NUMBER_MODES.has(el.inputMode) || el.type === 'tel' || el.type === 'number');
}

let installed = false;

export function installKeyboardDone(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // Label the Enter key "Done" on number keyboards.
  document.addEventListener('focusin', (e) => {
    if (isNumberBox(e.target) && !e.target.getAttribute('enterkeyhint')) {
      e.target.setAttribute('enterkeyhint', 'done');
    }
  });

  // ✓ / Done / Enter in a number box: close the keyboard, nothing else.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !isNumberBox(e.target)) return;
      e.preventDefault();
      e.target.blur();
    },
    true
  );
}

/** True while someone is typing in a box on a touch phone (the keyboard is up). */
export function usePhoneKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (!touch) return;
    const isField = (el: Element | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));
    const update = () => setOpen(isField(document.activeElement));
    // focusout fires before the next box gains focus; wait a tick to avoid flicker.
    const onFocusOut = () => setTimeout(update, 50);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
  return open;
}
