import React, { forwardRef } from 'react';

export type BadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual style of the badge. @default 'default' */
  variant?: BadgeVariant;
  /** Size of the badge. @default 'md' */
  size?: BadgeSize;
}

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  default: { backgroundColor: '#f3f4f6', color: '#374151' },
  primary: { backgroundColor: '#e0e7ff', color: '#3730a3' },
  success: { backgroundColor: '#dcfce7', color: '#166534' },
  warning: { backgroundColor: '#fef3c7', color: '#92400e' },
  danger: { backgroundColor: '#fee2e2', color: '#991b1b' },
  info: { backgroundColor: '#cffafe', color: '#155e75' },
};

const SIZE_STYLES: Record<BadgeSize, React.CSSProperties> = {
  sm: { fontSize: 11, padding: '1px 6px' },
  md: { fontSize: 12, padding: '2px 8px' },
  lg: { fontSize: 14, padding: '4px 10px' },
};

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: 9999,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

/** Accessible status badge; forwards all standard span props and a ref. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'default', size = 'md', style, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      style={{
        ...BASE_STYLE,
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
});
