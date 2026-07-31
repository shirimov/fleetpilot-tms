'use client';

import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0,
  );
}

type ModalLayerProps = {
  children: ReactNode;
  className: string;
  labelledBy: string;
  describedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  canCloseOnEscape?: () => boolean;
};

export default function ModalLayer({
  children,
  className,
  labelledBy,
  describedBy,
  initialFocusRef,
  onClose,
  canCloseOnEscape = () => true,
}: ModalLayerProps) {
  const [portalHost] = useState<HTMLDivElement | null>(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const canCloseOnEscapeRef = useRef(canCloseOnEscape);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    canCloseOnEscapeRef.current = canCloseOnEscape;
  }, [canCloseOnEscape, onClose]);

  useLayoutEffect(() => {
    if (!portalHost) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.append(portalHost);

    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== portalHost,
    );
    const previousBackgroundState = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        if (
          event.defaultPrevented ||
          !dialog.contains(document.activeElement) ||
          !canCloseOnEscapeRef.current()
        ) {
          return;
        }
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = visibleFocusableElements(dialog);
      event.preventDefault();
      if (focusable.length === 0) {
        dialog.focus();
        return;
      }
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex =
        currentIndex === -1
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : event.shiftKey
            ? (currentIndex - 1 + focusable.length) % focusable.length
            : (currentIndex + 1) % focusable.length;
      focusable[nextIndex]?.focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const target =
        initialFocusRef?.current ??
        (dialog ? visibleFocusableElements(dialog)[0] : null) ??
        dialog;
      target?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      previousBackgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      document.body.style.overflow = previousOverflow;
      portalHost.remove();
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [initialFocusRef, portalHost]);

  if (!portalHost) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={className}
    >
      {children}
    </div>,
    portalHost,
  );
}
