// SPDX-License-Identifier: MIT
import React, { forwardRef, useState } from "react";
import { theme } from "../theme";

export interface SegmentedOption {
  label: React.ReactNode;
  value: string;
  disabled?: boolean;
}

export interface SegmentedControlProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  options: SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}

export const SegmentedControl = forwardRef<
  HTMLDivElement,
  SegmentedControlProps
>(function SegmentedControl(
  {
    options,
    value,
    defaultValue,
    onChange,
    ariaLabel,
    disabled = false,
    style,
    ...rest
  },
  ref,
) {
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? options.find((option) => !option.disabled)?.value ?? "",
  );
  const selectedValue = value ?? internalValue;

  function select(option: SegmentedOption) {
    if (disabled || option.disabled) return;
    if (value === undefined) setInternalValue(option.value);
    onChange?.(option.value);
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const enabled = options
      .map((option, optionIndex) =>
        !option.disabled && !disabled ? optionIndex : -1,
      )
      .filter((optionIndex) => optionIndex >= 0);
    const current = enabled.indexOf(index);
    if (!enabled.length || current < 0) return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const target =
      enabled[(current + direction + enabled.length) % enabled.length];
    if (target === undefined) return;
    const targetOption = options[target];
    if (targetOption) select(targetOption);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[target]?.focus();
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        border: `1px solid ${theme.border}`,
        borderRadius: 7,
        background: theme.neutralBackground,
        ...style,
      }}
      {...rest}
    >
      {options.map((option) => {
        const selected = option.value === selectedValue;
        const isDisabled = disabled || !!option.disabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={isDisabled}
            onClick={() => select(option)}
            onKeyDown={(event) => handleKeyDown(event, options.indexOf(option))}
            style={{
              minHeight: 32,
              padding: "6px 11px",
              border: selected
                ? `1px solid ${theme.border}`
                : "1px solid transparent",
              borderRadius: 4,
              background: selected ? theme.surface : "transparent",
              color: selected ? theme.text : theme.neutralText,
              font: "inherit",
              cursor: isDisabled ? "not-allowed" : "pointer",
              opacity: isDisabled ? 0.5 : 1,
              boxShadow: selected ? `0 1px 2px ${theme.shadow}` : "none",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});
