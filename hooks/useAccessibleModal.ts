import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Shared accessibility hook for modal dialogs:
 * - Closes on Escape key
 * - Traps Tab / Shift+Tab focus inside the modal container
 * - Restores focus to the triggering element on close
 */
export const useAccessibleModal = (
  isOpen: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>
) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    // Move focus inside dialog if focus is still outside
    const focusTimer = requestAnimationFrame(() => {
      const targetContainer = containerRef.current;
      if (!targetContainer) return;
      if (!targetContainer.contains(document.activeElement)) {
        const focusables = targetContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length > 0) {
          focusables[0].focus({ preventScroll: true });
        } else {
          targetContainer.focus({ preventScroll: true });
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const targetContainer = containerRef.current;
        if (!targetContainer) return;
        const focusables = Array.from(
          targetContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!active || active === first || !targetContainer.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (!active || active === last || !targetContainer.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && container) {
        try {
          previouslyFocused.focus({ preventScroll: true });
        } catch {
          // ignore if element was removed from DOM
        }
      }
    };
  }, [isOpen, containerRef]);
};
