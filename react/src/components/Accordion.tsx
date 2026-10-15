// SPDX-License-Identifier: MIT
import React, { useId, useState } from "react";
import { theme } from "../theme";

export interface CollapsibleProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface AccordionItem {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface AccordionProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  items: AccordionItem[];
  value?: string | string[];
  defaultValue?: string | string[];
  multiple?: boolean;
  onValueChange?: (value: string | string[]) => void;
}

const TRIGGER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  padding: "12px 14px",
  border: 0,
  background: "transparent",
  color: theme.text,
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

function Panel({
  id,
  labelledBy,
  open,
  children,
}: {
  id: string;
  labelledBy: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div id={id} role="region" aria-labelledby={labelledBy} hidden={!open}>
      {children}
    </div>
  );
}

export function Collapsible({
  title,
  open,
  defaultOpen = false,
  disabled = false,
  onOpenChange,
  style,
  children,
  ...rest
}: CollapsibleProps) {
  const generatedId = useId();
  const panelId = `collapsible-panel-${generatedId}`;
  const triggerId = `${panelId}-trigger`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;

  const toggle = () => {
    if (disabled) return;
    const nextOpen = !isOpen;
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <div
      {...rest}
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        backgroundColor: theme.surface,
        ...style,
      }}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggle}
        style={{
          ...TRIGGER_STYLE,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span>{title}</span>
        <span aria-hidden="true">{isOpen ? "\u2212" : "+"}</span>
      </button>
      <Panel id={panelId} labelledBy={triggerId} open={isOpen}>
        <div style={{ padding: "0 14px 14px" }}>{children}</div>
      </Panel>
    </div>
  );
}

export function Accordion({
  items,
  value,
  defaultValue,
  multiple = false,
  onValueChange,
  style,
  ...rest
}: AccordionProps) {
  const generatedId = useId();
  const initialValue = defaultValue ?? (multiple ? [] : "");
  const [uncontrolledValue, setUncontrolledValue] = useState<string[]>(
    Array.isArray(initialValue)
      ? initialValue
      : initialValue
        ? [initialValue]
        : [],
  );
  const currentValue =
    value === undefined
      ? uncontrolledValue
      : Array.isArray(value)
        ? value
        : [value];

  const toggle = (itemId: string) => {
    const isOpen = currentValue.includes(itemId);
    const nextValue = multiple
      ? isOpen
        ? currentValue.filter((currentId) => currentId !== itemId)
        : [...currentValue, itemId]
      : isOpen
        ? []
        : [itemId];
    if (value === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(multiple ? nextValue : (nextValue[0] ?? ""));
  };

  return (
    <div
      {...rest}
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        backgroundColor: theme.surface,
        overflow: "hidden",
        ...style,
      }}
    >
      {items.map((item, index) => {
        const itemOpen = currentValue.includes(item.id);
        const triggerId = `accordion-${generatedId}-${item.id}-trigger`;
        const panelId = `accordion-${generatedId}-${item.id}-panel`;
        return (
          <div
            key={item.id}
            style={{ borderTop: index === 0 ? 0 : `1px solid ${theme.border}` }}
          >
            <button
              id={triggerId}
              type="button"
              aria-expanded={itemOpen}
              aria-controls={panelId}
              disabled={item.disabled}
              onClick={() => toggle(item.id)}
              style={{
                ...TRIGGER_STYLE,
                cursor: item.disabled ? "not-allowed" : "pointer",
              }}
            >
              <span>{item.title}</span>
              <span aria-hidden="true">{itemOpen ? "\u2212" : "+"}</span>
            </button>
            <Panel id={panelId} labelledBy={triggerId} open={itemOpen}>
              <div style={{ padding: "0 14px 14px" }}>{item.content}</div>
            </Panel>
          </div>
        );
      })}
    </div>
  );
}
