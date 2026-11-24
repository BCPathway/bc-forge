// SPDX-License-Identifier: MIT
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { theme } from "../theme";

/** Width preset of the dialog surface (#1149). */
export type ModalSize = "sm" | "md" | "lg";

/** Props of the accessible {@link Modal} dialog primitive (#1149). */
export interface ModalProps {
  /** Whether the dialog is mounted. Nothing is rendered while `false`. */
  open: boolean;
  /**
   * Called for every dismissal path: Escape, the close button, and a click on
   * the backdrop. The consumer owns `open`, so the dialog never closes itself.
   */
  onClose: () => void;
  /** Heading rendered in the header and wired to the dialog as its name. */
  title?: React.ReactNode;
  /** Supporting copy rendered under the title and wired via `aria-describedby`. */
  description?: React.ReactNode;
  /** Dialog body. */
  children?: React.ReactNode;
  /** Actions rendered under the body, separated by a rule. */
  footer?: React.ReactNode;
  /** Maximum width of the dialog surface. @default 'md' */
  size?: ModalSize;
  /** Dismiss when the backdrop is clicked. @default true */
  closeOnBackdropClick?: boolean;
  /** Dismiss when Escape is pressed. @default true */
  closeOnEscape?: boolean;
  /**
   * Element that receives focus when the dialog opens. Falls back to the first
   * focusable descendant, then to the dialog container itself.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * `id` of an element outside the dialog that labels it. Overrides `title` and
   * lets a page own the heading markup.
   */
  labelledBy?: string;
  /**
   * Explicit accessible name, used when neither `labelledBy` nor `title` is
   * given. Defaults to `'Dialog'` so the dialog is always named.
   */
  ariaLabel?: string;
  /** Accessible label of the header's close button. @default 'Close dialog' */
  closeLabel?: string;
  /** Optional CSS class on the dialog surface. */
  className?: string;
  /** Optional inline style merged into the dialog surface. */
  style?: React.CSSProperties;
}

/**
 * Selector for the elements that take part in the tab order. Native controls
 * are listed explicitly because `[tabindex]` alone misses them, and the
 * `:not([disabled])` guards keep disabled controls out of the trap.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Default accessible name, so a titleless dialog still passes axe-core. */
const DEFAULT_ARIA_LABEL = "Dialog";

const SIZE_STYLES: Record<ModalSize, React.CSSProperties> = {
  sm: { maxWidth: 420 },
  md: { maxWidth: 560 },
  lg: { maxWidth: 760 },
};

const BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  boxSizing: "border-box",
  backgroundColor: "rgba(17, 24, 39, 0.45)",
  // Blur the page behind the dialog so focus reads as being on the dialog.
  backdropFilter: "blur(6px)",
  fontFamily: "inherit",
};

const DIALOG_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  width: "100%",
  maxHeight: "100%",
  padding: 20,
  border: `1px solid ${theme.border}`,
  borderRadius: 12,
  backgroundColor: theme.surface,
  color: theme.text,
  boxShadow: `0 20px 40px ${theme.shadow}`,
  boxSizing: "border-box",
  overflowY: "auto",
  textAlign: "left",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1.3,
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 14,
  lineHeight: 1.5,
  color: theme.neutralText,
};

const CLOSE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "2px 8px",
  border: "1px solid transparent",
  borderRadius: 6,
  background: "transparent",
  color: theme.neutralText,
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
  fontFamily: "inherit",
};

const FOOTER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  paddingTop: 16,
  borderTop: `1px solid ${theme.border}`,
};

/** Marks the portal root so stacked dialogs can find the topmost one (#1149). */
const MODAL_ROOT_ATTRIBUTE = "data-modal-root";

/**
 * The backdrop of the nearest enclosing dialog, or `null` at the top level.
 *
 * A nested `Modal` portals into this element instead of `document.body`. That is
 * what keeps document order and visual stacking in agreement: React inserts
 * nested portals *child-first*, so two dialogs both portalled to `document.body`
 * land in the DOM as inner-then-outer and the outer one paints on top. By
 * nesting the portal instead, the inner dialog becomes a descendant of the outer
 * one and therefore renders above it — which is what the user sees, and what
 * {@link isTopmostModal} then correctly resolves.
 */
const ModalContainerContext = React.createContext<HTMLElement | null>(null);

/**
 * Whether `backdrop` is the last dialog root within its portal host (#1149).
 *
 * The search covers *descendants*, not just direct children, and that detail is
 * what makes stacking work: a nested dialog's backdrop lives inside its
 * parent's backdrop, so the parent's `querySelectorAll` finds the nested one
 * after itself and correctly reports itself as buried. Only the topmost dialog
 * reacts to Escape and owns the focus trap, so stacked dialogs do not close each
 * other or fight over focus.
 */
function isTopmostModal(backdrop: HTMLElement | null): boolean {
  const parent = backdrop?.parentElement;
  if (!parent) return true;
  const roots = parent.querySelectorAll(`[${MODAL_ROOT_ATTRIBUTE}]`);
  return roots[roots.length - 1] === backdrop;
}

let lockedModalCount = 0;
let savedBodyOverflow: string | null = null;

/**
 * Prevents the page behind the dialog from scrolling (#1149).
 *
 * Reference counted so stacked dialogs unlock exactly once, when the last one
 * closes, and the page's own `overflow` value is restored rather than cleared.
 */
function lockBodyScroll(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (lockedModalCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockedModalCount += 1;
}

function unlockBodyScroll(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (lockedModalCount === 0) return;
  lockedModalCount -= 1;
  if (lockedModalCount > 0 || savedBodyOverflow === null) return;
  document.body.style.overflow = savedBodyOverflow;
  savedBodyOverflow = null;
}

/**
 * Whether a candidate is visible enough to be tabbed to (#1149).
 *
 * Deliberately limited to what the element itself declares: layout-derived
 * visibility (`offsetParent`, `getClientRects`) is not implemented in jsdom and
 * would report every control as hidden in tests, hiding real regressions.
 */
function isVisible(node: HTMLElement): boolean {
  if (node.hidden) return false;
  if (node.getAttribute("aria-hidden") === "true") return false;
  return node.style.display !== "none" && node.style.visibility !== "hidden";
}

/** Focusable, visible descendants of `container`, in tab order (#1149). */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isVisible);
}

/**
 * Accessible modal dialog primitive (#1149).
 *
 * Rendered through a portal on `document.body` so it escapes any transformed or
 * `overflow: hidden` ancestor, and so it is the last thing in the tab order of
 * the page. While open it:
 *
 * - moves focus into the dialog (`initialFocusRef`, else the first focusable
 *   control, else the dialog container) and cycles Tab / Shift+Tab inside it;
 * - dismisses on Escape and on a backdrop click, both configurable;
 * - restores focus to whatever was focused when it opened, and locks the page
 *   behind it from scrolling.
 *
 * Stacked dialogs cooperate: only the topmost one traps focus and reacts to
 * Escape, and the scroll lock is released only when the last one closes.
 *
 * Semantics are `role="dialog"` with `aria-modal="true"`, labelled by `title`
 * (or `labelledBy`) and described by `description`, so the dialog always has an
 * accessible name.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdropClick = true,
  closeOnEscape = true,
  initialFocusRef,
  labelledBy,
  ariaLabel,
  closeLabel = "Close dialog",
  className,
  style,
}) => {
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // A dialog rendered inside another dialog portals into that dialog's backdrop,
  // so the inner one is both painted above the outer one and resolves as the
  // topmost root for Escape and the focus trap.
  const parentContainer = React.useContext(ModalContainerContext);
  // The backdrop only exists once the portal has rendered, so it is published to
  // descendants as state rather than being read during render.
  const [ownBackdrop, setOwnBackdrop] = React.useState<HTMLElement | null>(
    null,
  );
  const backdropRef = React.useCallback((node: HTMLDivElement | null) => {
    setOwnBackdrop(node);
  }, []);
  const portalContainer =
    parentContainer ?? (typeof document === "undefined" ? null : document.body);

  // Latest props for the window-level listeners, so an inline `onClose` does not
  // re-subscribe them (which would restart the focus handoff on every render).
  const handlersRef = useRef({ onClose, closeOnEscape, initialFocusRef });
  useEffect(() => {
    handlersRef.current = { onClose, closeOnEscape, initialFocusRef };
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const backdrop = dialog.parentElement;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    lockBodyScroll();

    const focusTarget =
      handlersRef.current.initialFocusRef?.current ?? getFocusable(dialog)[0];
    (focusTarget ?? dialog).focus();

    /** Keeps Tab and Shift+Tab inside the dialog while it is open (#1149). */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal(backdrop)) return;

      if (event.key === "Escape") {
        if (handlersRef.current.closeOnEscape) {
          event.preventDefault();
          handlersRef.current.onClose();
        }
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable(dialog);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing to cycle through: keep focus on the dialog itself.
        event.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement;
      const onDialog = active === dialog;
      if (event.shiftKey) {
        if (active === first || onDialog) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || onDialog) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      const restore = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (restore && restore.isConnected) restore.focus();
    };
  }, [open]);

  if (!open) return null;
  if (!portalContainer) return null;

  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const labelledByValue = labelledBy ?? (title ? titleId : undefined);
  const name = labelledByValue ? undefined : (ariaLabel ?? DEFAULT_ARIA_LABEL);

  const handleClose = () => handlersRef.current.onClose();

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only a click on the backdrop itself dismisses; clicks that bubble out of
    // the dialog surface are ignored.
    if (event.target !== event.currentTarget) return;
    if (closeOnBackdropClick) handlersRef.current.onClose();
  };

  return createPortal(
    <ModalContainerContext.Provider value={ownBackdrop}>
      <div
        ref={backdropRef}
        data-modal-root="true"
        data-testid="modal-backdrop"
        onClick={handleBackdropClick}
        style={BACKDROP_STYLE}
      >
        <div
          ref={dialogRef}
          id={`${baseId}-dialog`}
          data-testid="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledByValue}
          aria-label={name}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={className}
          style={{ ...DIALOG_STYLE, ...SIZE_STYLES[size], ...style }}
        >
          <div style={HEADER_STYLE}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {title ? (
                <h2 id={titleId} data-testid="modal-title" style={TITLE_STYLE}>
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p
                  id={descriptionId}
                  data-testid="modal-description"
                  style={DESCRIPTION_STYLE}
                >
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="modal-close"
              aria-label={closeLabel}
              onClick={handleClose}
              style={CLOSE_BUTTON_STYLE}
            >
              &times;
            </button>
          </div>

          <div data-testid="modal-body">{children}</div>

          {footer ? (
            <div data-testid="modal-footer" style={FOOTER_STYLE}>
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </ModalContainerContext.Provider>,
    portalContainer,
  );
};
