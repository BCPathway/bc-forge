// SPDX-License-Identifier: MIT
import React, { forwardRef } from 'react';
import { theme } from '../theme';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Visual + semantic style of the alert. @default 'info' */
  variant?: AlertVariant;
  /** Optional bold title rendered above the content. */
  title?: React.ReactNode;
  /** When provided, renders a dismiss button that calls this handler. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. @default 'Dismiss alert' */
  dismissLabel?: string;
}

const VARIANT_STYLES: Record<AlertVariant, React.CSSProperties> = {
  info: { backgroundColor: theme.primaryBackground, borderColor: theme.primaryBorder, color: theme.primaryText },
  success: { backgroundColor: theme.successBackground, borderColor: theme.successBorder, color: theme.successText },
  warning: { backgroundColor: theme.warningBackground, borderColor: theme.warningBorder, color: theme.warningText },
  danger: { backgroundColor: theme.dangerBackground, borderColor: theme.dangerBorder, color: theme.dangerText },
};

/** Alert banner; role is "alert" for danger/warning and "status" otherwise. */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { variant = 'info', title, onDismiss, dismissLabel = 'Dismiss alert', style, children, ...rest },
  ref,
) {
  const defaultRole = variant === 'danger' || variant === 'warning' ? 'alert' : 'status';

  return (
    <div
      ref={ref}
      role={defaultRole}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '12px 14px',
        border: '1px solid',
        borderRadius: 8,
        ...VARIANT_STYLES[variant],
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div> : null}
        <div style={{ fontSize: 14 }}>{children}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 18,
            lineHeight: 1,
            padding: 2,
          }}
        >
          &times;
        </button>
      ) : null}
    </div>
  );
});
