// SPDX-License-Identifier: MIT
import React, { forwardRef, useState } from 'react';
import { theme } from '../theme';

/** Sizing preset for the empty state's spacing and type scale. */
export type EmptyStateSize = 'sm' | 'md' | 'lg';

/**
 * Declarative form of the primary/secondary action. Supply an
 * {@link EmptyStateProps.action} object and the component renders the button;
 * pass any other node to render it yourself.
 */
export interface EmptyStateAction {
  /** Visible label, and therefore the button's accessible name. */
  label: string;
  /** Click handler. Ignored when `disabled` is true. */
  onClick?: () => void;
  /** Disables the button, e.g. when the action needs a connected wallet. */
  disabled?: boolean;
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Illustration above the message. Defaults to a built-in inline SVG; pass
   * `null` to render no icon at all.
   */
  icon?: React.ReactNode;
  /** Short headline, e.g. `'No transactions yet'`. */
  title: string;
  /** One or two sentences explaining what to do next. */
  description?: React.ReactNode;
  /** Primary next step: an {@link EmptyStateAction}, or a node to render as-is. */
  action?: EmptyStateAction | React.ReactNode;
  /** Optional lower-emphasis alternative to {@link EmptyStateProps.action}. */
  secondaryAction?: EmptyStateAction | React.ReactNode;
  /** Sizing preset. @default 'md' */
  size?: EmptyStateSize;
}

const ROOT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const SIZE_STYLES: Record<EmptyStateSize, React.CSSProperties> = {
  sm: { padding: '24px 16px', gap: 8 },
  md: { padding: '40px 24px', gap: 12 },
  lg: { padding: '64px 32px', gap: 16 },
};

const ICON_WRAP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.neutralText,
};

const TITLE_SIZE_STYLES: Record<EmptyStateSize, React.CSSProperties> = {
  sm: { fontSize: 14 },
  md: { fontSize: 16 },
  lg: { fontSize: 20 },
};

const TITLE_STYLE: React.CSSProperties = {
  fontWeight: 600,
  color: theme.text,
  lineHeight: 1.35,
};

const DESCRIPTION_SIZE_STYLES: Record<EmptyStateSize, React.CSSProperties> = {
  sm: { fontSize: 12 },
  md: { fontSize: 14 },
  lg: { fontSize: 15 },
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  color: theme.neutralText,
  lineHeight: 1.5,
  maxWidth: 440,
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 4,
};

const ACTION_BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
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

/** Tones available to the action buttons. */
export type EmptyStateActionVariant = 'primary' | 'secondary';

const VARIANT_ACTION_STYLES: Record<EmptyStateActionVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
    color: theme.surface,
  },
  secondary: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    color: theme.text,
  },
};

const VARIANT_FOCUS_STYLES: Record<EmptyStateActionVariant, React.CSSProperties> = {
  primary: { borderColor: theme.primary, boxShadow: `0 0 0 2px ${theme.primaryFocusRing}` },
  secondary: { borderColor: theme.focus, boxShadow: `0 0 0 2px ${theme.focusRing}` },
};

const ACTION_DISABLED_STYLE: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

/** Side length of the built-in illustration, in pixels. */
const DEFAULT_ICON_SIZE = 72;

/**
 * Tells the declarative `{ label, onClick, disabled }` form apart from an
 * already-built node, so consumers can pass either without a wrapper component.
 */
function isEmptyStateAction(value: unknown): value is EmptyStateAction {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (React.isValidElement(value)) return false;
  return 'label' in value && typeof value.label === 'string';
}

/**
 * Empty listing placeholder for tables, search results and filtered views
 * (#1168).
 *
 * It states what is missing, why it is missing, and offers the one action that
 * moves things forward — the point being that an empty table should never be a
 * dead end. Everything is centred with generous vertical padding so it drops
 * into a listing container without further layout work, and the illustration is
 * an inline SVG built from `theme` tokens, so there is no icon font or asset to
 * load.
 *
 * Accessibility: the default illustration is `aria-hidden`, the title is real
 * heading-level text rather than an image, and both action buttons are native
 * `<button>`s with the label as their accessible name. The root accepts a
 * `role` through the spread props for callers that want to announce the change,
 * e.g. `role="status"` after a search returns nothing.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, secondaryAction, size = 'md', style, ...rest },
  ref,
) {
  // Inline styles cannot express `:focus-visible`, so the focus ring is toggled
  // from state keyed by whichever action last took focus.
  const [focusedAction, setFocusedAction] = useState<string | null>(null);

  const actionStyle = (
    key: string,
    variant: EmptyStateActionVariant,
    disabled: boolean,
  ): React.CSSProperties => ({
    ...ACTION_BASE_STYLE,
    ...VARIANT_ACTION_STYLES[variant],
    ...(focusedAction === key && !disabled ? VARIANT_FOCUS_STYLES[variant] : {}),
    ...(disabled ? ACTION_DISABLED_STYLE : {}),
  });

  /** Renders either a passed-in node, or the declarative button form. */
  const renderAction = (
    value: EmptyStateAction | React.ReactNode,
    key: 'action' | 'secondary-action',
    variant: EmptyStateActionVariant,
  ) => {
    if (!isEmptyStateAction(value)) return <React.Fragment key={key}>{value}</React.Fragment>;

    const disabled = value.disabled === true;
    return (
      <button
        key={key}
        type="button"
        data-testid={`empty-state-${key}`}
        disabled={disabled}
        onClick={value.onClick}
        onFocus={() => setFocusedAction(key)}
        onBlur={() => setFocusedAction(null)}
        style={actionStyle(key, variant, disabled)}
      >
        {value.label}
      </button>
    );
  };

  const hasAction = action !== undefined && action !== null;
  const hasSecondaryAction = secondaryAction !== undefined && secondaryAction !== null;

  return (
    <div
      ref={ref}
      data-testid="empty-state"
      style={{ ...ROOT_STYLE, ...SIZE_STYLES[size], ...style }}
      {...rest}
    >
      {icon === undefined ? (
        <span data-testid="empty-state-icon-wrap" style={ICON_WRAP_STYLE}>
          <DefaultEmptyStateIcon />
        </span>
      ) : icon === null ? null : (
        <span data-testid="empty-state-icon-wrap" style={ICON_WRAP_STYLE}>
          {icon}
        </span>
      )}

      <span
        data-testid="empty-state-title"
        style={{ ...TITLE_STYLE, ...TITLE_SIZE_STYLES[size] }}
      >
        {title}
      </span>

      {description ? (
        <span
          data-testid="empty-state-description"
          style={{ ...DESCRIPTION_STYLE, ...DESCRIPTION_SIZE_STYLES[size] }}
        >
          {description}
        </span>
      ) : null}

      {hasAction || hasSecondaryAction ? (
        <div data-testid="empty-state-actions" style={ACTIONS_STYLE}>
          {hasAction ? renderAction(action, 'action', 'primary') : null}
          {hasSecondaryAction ? renderAction(secondaryAction, 'secondary-action', 'secondary') : null}
        </div>
      ) : null}
    </div>
  );
});

/**
 * Built-in illustration: an empty tray inside a soft disc. Purely decorative,
 * so it is hidden from assistive technology and coloured with `currentColor`
 * plus a neutral background token.
 */
const DefaultEmptyStateIcon: React.FC = () => (
  <svg
    data-testid="empty-state-default-icon"
    width={DEFAULT_ICON_SIZE}
    height={DEFAULT_ICON_SIZE}
    viewBox="0 0 72 72"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="36" cy="36" r="35" fill={theme.neutralBackground} />
    <path
      d="M18 24h36a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3Z"
      stroke="currentColor"
      strokeWidth="2.5"
    />
    <path
      d="M15 40h11l3 5h14l3-5h11"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M27 30h18"
      stroke={theme.border}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);