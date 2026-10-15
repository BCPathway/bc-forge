// SPDX-License-Identifier: MIT
import React, { forwardRef } from "react";
import { theme } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
}

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
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
  danger: {
    backgroundColor: theme.danger,
    borderColor: theme.danger,
    color: theme.surface,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    color: theme.text,
  },
};

const SIZES: Record<ButtonSize, React.CSSProperties> = {
  sm: { minHeight: 30, padding: "5px 10px", fontSize: 12 },
  md: { minHeight: 38, padding: "8px 14px", fontSize: 14 },
  lg: { minHeight: 46, padding: "10px 18px", fontSize: 16 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      loadingText,
      disabled,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          border: "1px solid",
          borderRadius: 6,
          fontFamily: "inherit",
          fontWeight: 600,
          lineHeight: 1.4,
          cursor: disabled || loading ? "not-allowed" : "pointer",
          opacity: disabled && !loading ? 0.55 : 1,
          boxSizing: "border-box",
          ...VARIANTS[variant],
          ...SIZES[size],
          ...style,
        }}
        {...rest}
      >
        {loading ? (
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            style={{ flexShrink: 0 }}
          >
            <g>
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                opacity="0.25"
              />
              <path
                d="M12 3a9 9 0 0 1 9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0 12 12"
                to="360 12 12"
                dur="0.8s"
                repeatCount="indefinite"
              />
            </g>
          </svg>
        ) : null}
        {loading ? (loadingText ?? children) : children}
      </button>
    );
  },
);
