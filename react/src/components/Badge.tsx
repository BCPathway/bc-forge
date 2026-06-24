import React, { forwardRef } from 'react';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual variant of the badge. @default 'default' */
  variant?: BadgeVariant;
  /** Size of the badge. @default 'md' */
  size?: BadgeSize;
}

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  default: { backgroundColor: '#f3f4f6', color: '#374151' },
  primary: { backgroundColor: '#eff6ff', color: '#1e40af' },
  success: { backgroundColor: '#f0fdf4', color: '#166534' },
  warning: { backgroundColor: '#fffbeb', color: '#92400e' },
  danger: { backgroundColor: '#fef2f2', color: '#991b1b' },
  info: { backgroundColor: '#ecfeff', color: '#155e75' },
};

const SIZE_STYLES: Record<BadgeSize, React.CSSProperties> = {
  sm: { fontSize: 11, padding: '1px 6px', borderRadius: 8 },
  md: { fontSize: 12, padding: '2px 8px', borderRadius: 10 },
  lg: { fontSize: 14, padding: '3px 10px', borderRadius: 12 },
};

const BADGE_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

/** Badge label. When `onClick` is provided the element becomes a
 * keyboard-focusable interactive control (role="button", tabIndex={0},
 * Enter/Space activation). Pass explicit `role` or `tabIndex` to override. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'default', size = 'md', style, onClick, onKeyDown, children, ...rest },
  ref,
) {
  const isInteractive = Boolean(onClick);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick!(e as unknown as React.MouseEvent<HTMLSpanElement>);
    }
    onKeyDown?.(e);
  };

  return (
    <span
      ref={ref}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      style={{
        ...BADGE_BASE,
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...(isInteractive ? { cursor: 'pointer' } : {}),
        ...style,
      }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </span>
  );
});
