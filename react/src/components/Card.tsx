import React, { forwardRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { Slot } from './Slot';

export type CardVariant = 'elevated' | 'outlined' | 'filled';
export type CardSize = 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual style variant of the card. @default 'elevated' */
  variant?: CardVariant;
  /** Size preset controlling padding. @default 'md' */
  size?: CardSize;
  /** When true, the card merges its props onto the single child element instead of rendering a wrapper div. */
  asChild?: boolean;
}

const variantStyles: Record<CardVariant, React.CSSProperties> = {
  elevated: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    boxShadow:
      '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  },
  outlined: {
    backgroundColor: 'transparent',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
  },
  filled: {
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
  },
};

const sizeStyles: Record<CardSize, React.CSSProperties> = {
  sm: { padding: '16px' },
  md: { padding: '24px' },
  lg: { padding: '32px' },
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'elevated',
      size = 'md',
      asChild = false,
      className,
      style,
      onClick,
      onKeyDown,
      tabIndex,
      role,
      children,
      ...props
    },
    ref,
  ) => {
    const isInteractive = !!onClick;

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick(event as unknown as React.MouseEvent<HTMLDivElement>);
        }
      },
      [onClick, onKeyDown],
    );

    const mergedStyle = {
      ...variantStyles[variant],
      ...sizeStyles[size],
      ...style,
    };

    const mergedClassName = clsx('bc-forge-card', className);

    const commonProps = {
      ref,
      className: mergedClassName,
      style: mergedStyle,
      onClick,
      onKeyDown: isInteractive ? handleKeyDown : onKeyDown,
      tabIndex: isInteractive ? (tabIndex ?? 0) : tabIndex,
      role: isInteractive ? (role ?? 'button') : role,
      ...props,
    };

    if (asChild) {
      return <Slot {...commonProps}>{children}</Slot>;
    }

    return <div {...commonProps}>{children}</div>;
  },
);

Card.displayName = 'Card';
