// SPDX-License-Identifier: MIT
import React, { forwardRef, useId, useState } from "react";
import { theme } from "../theme";

export interface TabItem {
  label: React.ReactNode;
  value: string;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { items, value, defaultValue, onChange, ariaLabel = "Tabs", style, ...rest },
  ref,
) {
  const id = useId();
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? items.find((item) => !item.disabled)?.value ?? "",
  );
  const activeValue = value ?? internalValue;
  const activeIndex = items.findIndex(
    (item) => item.value === activeValue && !item.disabled,
  );
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;

  function select(item: TabItem) {
    if (item.disabled) return;
    if (value === undefined) setInternalValue(item.value);
    onChange?.(item.value);
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home" || event.key === "End" || direction !== 0) {
      event.preventDefault();
      const available = items
        .map((item, itemIndex) => (!item.disabled ? itemIndex : -1))
        .filter((itemIndex) => itemIndex >= 0);
      if (!available.length) return;
      const target =
        event.key === "Home"
          ? available[0]
          : event.key === "End"
            ? available[available.length - 1]
            : available[
                (available.indexOf(index) + direction + available.length) %
                  available.length
              ];
      if (target === undefined) return;
      const button = document.getElementById(`${id}-tab-${target}`);
      button?.focus();
      const targetItem = items[target];
      if (targetItem) select(targetItem);
    }
  }

  return (
    <div ref={ref} style={style} {...rest}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        style={{
          display: "flex",
          gap: 4,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        {items.map((item, index) => {
          const selected = item.value === activeItem?.value;
          return (
            <button
              key={item.value}
              id={`${id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              style={{
                border: 0,
                borderBottom: selected
                  ? `2px solid ${theme.primary}`
                  : "2px solid transparent",
                marginBottom: -1,
                padding: "9px 12px",
                background: "transparent",
                color: selected ? theme.primary : theme.neutralText,
                font: "inherit",
                cursor: item.disabled ? "not-allowed" : "pointer",
                opacity: item.disabled ? 0.5 : 1,
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${activeIndex}`}
          tabIndex={0}
          style={{ paddingTop: 12 }}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
});
