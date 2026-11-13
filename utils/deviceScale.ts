/**
 * Device-adaptive UI & typography scaling utilities.
 *
 * Calibrates the root `<html>` font-size (`1rem`) based on the device's viewport
 * dimensions and neutralizes runaway OS/browser default font inflation so that
 * Tailwind's `rem`-based font sizes and element dimensions stay proportional
 * across small phones, Display-Zoomed devices, tablets, and desktops.
 */

const MIN_ROOT_PX = 12.5;
const MAX_ROOT_PX = 16;

let lastWidth = 0;
let stableHeight = 0;

function isTextInputFocused(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.isContentEditable);
}

/**
 * Computes the ideal base `1rem` pixel size for a given CSS viewport width & height.
 */
export function computeTargetRootFontSize(width: number, height: number): number {
  const safeWidth = Math.max(280, width || 390);
  const safeHeight = Math.max(320, height || 720);

  // Width-based curve:
  // 280px -> 12.5px | 320px -> 13.25px | 390px -> 15.0px | 640px+ -> 16.0px
  let widthBasedPx = MAX_ROOT_PX;
  if (safeWidth < 320) {
    const t = (safeWidth - 280) / (320 - 280);
    widthBasedPx = 12.5 + t * (13.25 - 12.5);
  } else if (safeWidth < 390) {
    const t = (safeWidth - 320) / (390 - 320);
    widthBasedPx = 13.25 + t * (15.0 - 13.25);
  } else if (safeWidth < 640) {
    const t = (safeWidth - 390) / (640 - 390);
    widthBasedPx = 15.0 + t * (MAX_ROOT_PX - 15.0);
  }

  // Height-based cap so compact / landscape / Display-Zoomed viewports never feel cramped:
  // <= 420px -> 13.5px | 680px+ -> 16.0px
  let heightCapPx = MAX_ROOT_PX;
  if (safeHeight < 680) {
    const t = Math.max(0, (safeHeight - 420) / (680 - 420));
    heightCapPx = 13.5 + t * (MAX_ROOT_PX - 13.5);
  }

  const target = Math.min(widthBasedPx, heightCapPx);
  return Math.round(Math.min(MAX_ROOT_PX, Math.max(MIN_ROOT_PX, target)) * 100) / 100;
}

/**
 * Applies the calibrated root `font-size` to `<html>` and compensates if the OS
 * or WebView applies an extra font-scale multiplier on top of explicit CSS `px`.
 */
export function applyDeviceRootScale(
  doc: Document = document,
  win: Window = window
): number {
  const root = doc.documentElement;
  if (!root) return MAX_ROOT_PX;

  const rawWidth = win.innerWidth || root.clientWidth || 390;
  const rawHeight = win.innerHeight || root.clientHeight || 720;

  // Avoid shrinking the entire UI when a mobile virtual keyboard temporarily reduces innerHeight
  const widthChanged = Math.abs(rawWidth - lastWidth) > 2;
  if (widthChanged || !isTextInputFocused(doc) || rawHeight > stableHeight || stableHeight === 0) {
    lastWidth = rawWidth;
    stableHeight = rawHeight;
  }

  const targetPx = computeTargetRootFontSize(rawWidth, stableHeight);
  root.style.fontSize = `${targetPx}px`;

  // If OS / browser text-zoom multiplied our explicit px root font-size, counter-scale it
  const renderedPx = parseFloat(win.getComputedStyle(root).fontSize);
  if (Number.isFinite(renderedPx) && renderedPx > 0 && Math.abs(renderedPx - targetPx) > 0.2) {
    const compensatedPx = Math.min(20, Math.max(7, (targetPx * targetPx) / renderedPx));
    root.style.fontSize = `${Math.round(compensatedPx * 100) / 100}px`;
  }

  root.dataset.targetRootPx = String(targetPx);
  return targetPx;
}

/**
 * Keeps root scaling synchronized across window resizes and device orientation changes.
 */
export function installDeviceRootScaleListeners(
  doc: Document = document,
  win: Window = window
): () => void {
  let rafId: number | null = null;

  const scheduleUpdate = () => {
    if (rafId !== null) {
      win.cancelAnimationFrame(rafId);
    }
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      applyDeviceRootScale(doc, win);
    });
  };

  applyDeviceRootScale(doc, win);

  win.addEventListener('resize', scheduleUpdate, { passive: true });
  win.addEventListener('orientationchange', scheduleUpdate, { passive: true });

  return () => {
    if (rafId !== null) {
      win.cancelAnimationFrame(rafId);
    }
    win.removeEventListener('resize', scheduleUpdate);
    win.removeEventListener('orientationchange', scheduleUpdate);
  };
}

/**
 * Returns responsive Tailwind font-size classes adapted to word length so long
 * vocabulary terms never overflow or wrap awkwardly inside flashcards.
 */
export function getAdaptiveWordHeadingClass(
  word: string,
  variant: 'study' | 'quiz' | 'card' = 'study'
): string {
  const len = (word || '').trim().length;

  if (variant === 'study') {
    if (len > 20) return 'text-xl sm:text-2xl md:text-3xl';
    if (len > 14) return 'text-2xl sm:text-3xl md:text-4xl';
    if (len > 10) return 'text-3xl sm:text-4xl md:text-[2.75rem]';
    return 'text-3xl sm:text-4xl md:text-5xl';
  }

  if (variant === 'quiz') {
    if (len > 20) return 'text-xl sm:text-2xl md:text-3xl';
    if (len > 13) return 'text-2xl sm:text-3xl md:text-[2.125rem]';
    return 'text-2xl sm:text-3xl md:text-4xl';
  }

  // 'card' (Flashcards deck grid & Dashboard preview modal)
  if (len > 18) return 'text-lg sm:text-xl';
  if (len > 12) return 'text-xl sm:text-2xl';
  return 'text-2xl sm:text-3xl';
}
