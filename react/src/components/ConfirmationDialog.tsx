// SPDX-License-Identifier: MIT
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../theme';

/** Tone of the dialog: `danger` for irreversible writes, `warning` for caution. */
export type ConfirmationDialogVariant = 'danger' | 'warning';

/**
 * How the user has to acknowledge the action before Confirm unlocks.
 *
 * - `checkbox` — tick a confirmation box.
 * - `keyword` — type {@link ConfirmationDialogProps.confirmationKeyword}.
 * - `none` — no gate; the dialog is informational.
 */
export type ConfirmationMode = 'checkbox' | 'keyword' | 'none';

/** Word used by the `'keyword'` gate when the consumer does not supply one. */
export const DEFAULT_CONFIRMATION_KEYWORD = 'CONFIRM';

export interface ConfirmationDialogProps {
  /** Whether the dialog is mounted. Nothing renders while this is false. */
  open: boolean;
  /** Called by Cancel, the backdrop, and `Escape`. */
  onClose: () => void;
  /** Called by Confirm, once the confirmation gate has been satisfied. */
  onConfirm: () => void;
  /** Heading, wired to the dialog through `aria-labelledby`. */
  title: string;
  /** Body copy, wired to the dialog through `aria-describedby`. */
  description?: React.ReactNode;
  /** Extra content rendered between the description and the gate. */
  children?: React.ReactNode;
  /** Label of the confirming button. @default 'Confirm' */
  confirmLabel?: string;
  /** Label of the dismissing button. @default 'Cancel' */
  cancelLabel?: string;
  /** Label shown on Confirm while `busy`. @default 'Working…' */
  busyLabel?: string;
  /** Tone of the dialog and of its confirming button. @default 'danger' */
  variant?: ConfirmationDialogVariant;
  /** Which acknowledgement gate guards the Confirm button. @default 'checkbox' */
  confirmationMode?: ConfirmationMode;
  /**
   * Word the user must type in `'keyword'` mode. Comparison ignores case and
   * surrounding whitespace. @default {@link DEFAULT_CONFIRMATION_KEYWORD}
   */
  confirmationKeyword?: string;
  /** Text of the confirmation checkbox. @default 'I understand this cannot be undone.' */
  confirmationLabel?: string;
  /** Label above the keyword field in `'keyword'` mode. */
  keywordLabel?: string;
  /**
   * Marks an in-flight transaction: Confirm and Cancel go dead, the button
   * shows `busyLabel`, and `Escape` stops closing the dialog so the result of
   * the pending write is not lost.
   */
  busy?: boolean;
  /** Close when the backdrop is clicked. @default true */
  closeOnBackdropClick?: boolean;
  /** Close when `Escape` is pressed. @default true */
  closeOnEscape?: boolean;
  /** Portal host; defaults to `document.body`. */
  portalContainer?: HTMLElement | null;
  /** Optional container CSS class. */
  className?: string;
  /** Optional container style, merged last so it wins over the defaults. */
  style?: React.CSSProperties;
}

/** Internal props shared by the exported shell and the mounted dialog body. */
interface ConfirmationDialogBodyProps extends ConfirmationDialogProps {
  /** Resolved portal host the body renders itself into. */
  container: HTMLElement;
}

const BACKDROP_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  backgroundColor: 'rgba(17, 24, 39, 0.55)',
  zIndex: 1000,
  boxSizing: 'border-box',
};

const PANEL_BASE_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 20,
  border: '1px solid',
  borderRadius: 12,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: 'inherit',
  boxShadow: `0 20px 45px ${theme.shadow}`,
  boxSizing: 'border-box',
};

const VARIANT_PANEL_STYLES: Record<ConfirmationDialogVariant, React.CSSProperties> = {
  danger: { borderColor: theme.dangerBorder },
  warning: { borderColor: theme.warningBorder },
};

const VARIANT_ACCENT_STYLES: Record<ConfirmationDialogVariant, React.CSSProperties> = {
  danger: { color: theme.danger },
  warning: { color: theme.warningText },
};

const TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1.3,
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.5,
  color: theme.neutralText,
};

const BODY_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: theme.neutralText,
};

const WARNING_ICON_STYLE: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
};

const CHECKBOX_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 12px',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  backgroundColor: theme.neutralBackground,
  fontSize: 13,
  lineHeight: 1.4,
  cursor: 'pointer',
};

const CHECKBOX_STYLE: React.CSSProperties = {
  margin: 2,
  accentColor: theme.danger,
  cursor: 'pointer',
};

const KEYWORD_FIELD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const KEYWORD_LABEL_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: theme.neutralText,
};

const KEYWORD_INPUT_BASE_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: 'inherit',
  fontSize: 14,
  boxSizing: 'border-box',
};

const KEYWORD_INPUT_FOCUS_STYLE: React.CSSProperties = {
  outline: 'none',
  borderColor: theme.focus,
  boxShadow: `0 0 0 2px ${theme.focusRing}`,
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const BUTTON_BASE_STYLE: React.CSSProperties = {
  padding: '9px 16px',
  border: '1px solid',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  boxSizing: 'border-box',
  transition: 'box-shadow 0.15s, border-color 0.15s, opacity 0.15s',
};

const CANCEL_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_BASE_STYLE,
  backgroundColor: theme.surface,
  borderColor: theme.border,
  color: theme.text,
};

const VARIANT_CONFIRM_STYLES: Record<ConfirmationDialogVariant, React.CSSProperties> = {
  danger: { backgroundColor: theme.danger, borderColor: theme.danger, color: theme.surface },
  warning: { backgroundColor: theme.warningText, borderColor: theme.warningText, color: theme.surface },
};

const BUTTON_DISABLED_STYLE: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

/**
 * Everything the focus trap can land on. `:not([disabled])` already removes the
 * dead controls, so the trap only ever cycles live ones.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Collects the focusable descendants of `container`, in tab order. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Resolves the portal host, staying safe when there is no `document` (SSR). */
function resolvePortalContainer(
  portalContainer: HTMLElement | null | undefined,
): HTMLElement | null {
  if (portalContainer !== null && portalContainer !== undefined) return portalContainer;
  if (typeof document === 'undefined') return null;
  return document.body;
}

/**
 * Whether a React node will render anything. An empty string, an empty array,
 * `null`, `undefined` and `false` all count as "nothing".
 */
function hasContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === '') return false;
  if (Array.isArray(node)) return node.length > 0;
  return true;
}

/**
 * Confirmation dialog for dangerous actions such as a burn or a role revoke
 * (#1167).
 *
 * The dialog is entirely self-contained: it renders through its own
 * `createPortal` call, owns its backdrop, its `Escape` handling and its focus
 * trap, and shares no primitive with the rest of the library.
 *
 * Confirm stays disabled until the acknowledgement gate is satisfied — the
 * confirmation checkbox in `'checkbox'` mode, an exact (case-insensitive) match
 * of `confirmationKeyword` in `'keyword'` mode, and nothing at all in `'none'`
 * mode. `busy` additionally locks both buttons and stops `Escape` from
 * dismissing the dialog mid-transaction.
 *
 * While open, focus moves onto the panel and is trapped there by `Tab` /
 * `Shift+Tab`; the previously focused element is refocused on close, background
 * scrolling is locked, and the whole body is unmounted again when `open` turns
 * false — which is what resets the gate between openings.
 */
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  portalContainer,
  ...props
}) => {
  const container = resolvePortalContainer(portalContainer);
  // Closed (or server-rendered) renders nothing at all. Mounting the body only
  // while open is also how the confirmation gate resets between openings.
  if (!props.open || container === null) return null;
  return <ConfirmationDialogBody {...props} container={container} />;
};

/**
 * The mounted dialog. Every hook lives here, so unmounting (which happens as
 * soon as `open` turns false) discards the checkbox, the typed keyword and the
 * focus bookkeeping without any reset effect.
 */
const ConfirmationDialogBody: React.FC<ConfirmationDialogBodyProps> = ({
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busyLabel = 'Working…',
  variant = 'danger',
  confirmationMode = 'checkbox',
  confirmationKeyword = DEFAULT_CONFIRMATION_KEYWORD,
  confirmationLabel = 'I understand this action cannot be undone.',
  keywordLabel,
  busy = false,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  container,
  className,
  style,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const keywordFieldId = useId();

  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Element focused before the dialog opened, refocused on unmount. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Inline styles have no `:focus-visible`, so the focus ring is driven from
  // state keyed by whichever control last took focus.
  const [focusedControl, setFocusedControl] = useState<string | null>(null);

  /** State transition: tick or untick the confirmation checkbox. */
  const [acknowledged, setAcknowledged] = useState(false);
  /** State transition: keystroke in the keyword field. */
  const [typedKeyword, setTypedKeyword] = useState('');

  // Mount: remember what had focus, move focus onto the panel itself (never
  // straight onto the destructive button) and lock background scrolling.
  // Unmount: give scrolling and focus back to the page.
  useEffect(() => {
    const activeElement = document.activeElement;
    restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    const panel = panelRef.current;
    if (panel) panel.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, []);

  // Escape is bound on the document rather than the panel so it still works
  // while focus sits on the panel itself, and it is unbound while `busy` so a
  // pending transaction cannot be dismissed by a stray key press.
  useEffect(() => {
    if (!closeOnEscape || busy) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, busy, onClose]);

  const expectedKeyword = confirmationKeyword.trim();
  const keywordSatisfied =
    expectedKeyword.length > 0 &&
    typedKeyword.trim().toLowerCase() === expectedKeyword.toLowerCase();

  const gateSatisfied =
    confirmationMode === 'none'
      ? true
      : confirmationMode === 'keyword'
        ? keywordSatisfied
        : acknowledged;

  const canConfirm = gateSatisfied && !busy;

  const showBody = hasContent(description) || hasContent(children);
  const bodyNode = showBody ? (
    <div data-testid="confirmation-dialog-body" id={descriptionId} style={BODY_STYLE}>
      {hasContent(description) ? (
        <p data-testid="confirmation-dialog-description" style={DESCRIPTION_STYLE}>
          {description}
        </p>
      ) : null}
      {children}
    </div>
  ) : null;

  /** Only a click on the backdrop itself dismisses, never one that bubbled up from the panel. */
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!closeOnBackdropClick || busy) return;
    onClose();
  };

  /** Keeps `Tab` cycling inside the panel, and holds focus on the panel when it has nothing else. */
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = getFocusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /** Cancelling is refused while a transaction is in flight. */
  const handleCancel = () => {
    if (busy) return;
    onClose();
  };

  /** Re-checks the gate so a stale closure can never confirm an unsatisfied dialog. */
  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm();
  };

  const focusHandlers = (key: string) => ({
    onFocus: () => setFocusedControl(key),
    onBlur: () => setFocusedControl(null),
  });

  const confirmStyle: React.CSSProperties = {
    ...BUTTON_BASE_STYLE,
    ...VARIANT_CONFIRM_STYLES[variant],
    ...(focusedControl === 'confirm' && canConfirm
      ? { boxShadow: `0 0 0 3px ${theme.dangerFocusRing}` }
      : {}),
    ...(!canConfirm ? BUTTON_DISABLED_STYLE : {}),
  };

  const cancelStyle: React.CSSProperties = {
    ...CANCEL_BUTTON_STYLE,
    ...(focusedControl === 'cancel' && !busy
      ? { borderColor: theme.focus, boxShadow: `0 0 0 2px ${theme.focusRing}` }
      : {}),
    ...(busy ? BUTTON_DISABLED_STYLE : {}),
  };

  return createPortal(
    <div
      data-testid="confirmation-dialog-backdrop"
      style={BACKDROP_STYLE}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        data-testid="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={showBody ? descriptionId : undefined}
        tabIndex={-1}
        className={className}
        style={{ ...PANEL_BASE_STYLE, ...VARIANT_PANEL_STYLES[variant], ...style }}
        onKeyDown={handlePanelKeyDown}
      >
        <span
          aria-hidden="true"
          data-testid="confirmation-dialog-icon"
          style={{ ...WARNING_ICON_STYLE, ...VARIANT_ACCENT_STYLES[variant] }}
        >
          ⚠
        </span>

        <h2 id={titleId} data-testid="confirmation-dialog-title" style={TITLE_STYLE}>
          {title}
        </h2>

        {bodyNode}

        {confirmationMode === 'checkbox' ? (
          <label data-testid="confirmation-dialog-checkbox-label" style={CHECKBOX_ROW_STYLE}>
            <input
              type="checkbox"
              data-testid="confirmation-dialog-checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              style={CHECKBOX_STYLE}
              {...focusHandlers('checkbox')}
            />
            <span>{confirmationLabel}</span>
          </label>
        ) : null}

        {confirmationMode === 'keyword' ? (
          <div data-testid="confirmation-dialog-keyword-field" style={KEYWORD_FIELD_STYLE}>
            <label htmlFor={keywordFieldId} style={KEYWORD_LABEL_STYLE}>
              {keywordLabel ?? `Type ${expectedKeyword} to confirm this action.`}
            </label>
            <input
              id={keywordFieldId}
              type="text"
              data-testid="confirmation-dialog-keyword-input"
              value={typedKeyword}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTypedKeyword(event.target.value)}
              style={{
                ...KEYWORD_INPUT_BASE_STYLE,
                ...(focusedControl === 'keyword' ? KEYWORD_INPUT_FOCUS_STYLE : {}),
              }}
              {...focusHandlers('keyword')}
            />
          </div>
        ) : null}

        <div data-testid="confirmation-dialog-actions" style={ACTIONS_STYLE}>
          <button
            type="button"
            data-testid="confirmation-dialog-cancel"
            disabled={busy}
            onClick={handleCancel}
            style={cancelStyle}
            {...focusHandlers('cancel')}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirmation-dialog-confirm"
            disabled={!canConfirm}
            onClick={handleConfirm}
            style={confirmStyle}
            {...focusHandlers('confirm')}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    container,
  );
};