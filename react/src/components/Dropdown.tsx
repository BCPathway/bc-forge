import React, { forwardRef, useState, useRef, useEffect } from 'react';

export type DropdownVariant = 'default' | 'primary' | 'danger';
export type DropdownSize = 'sm' | 'md' | 'lg';

export interface DropdownItem {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface DropdownProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Array of menu items to display. */
  items: DropdownItem[];
  /** Controlled selected value. */
  value?: string;
  /** Initial selected value (uncontrolled). */
  defaultValue?: string;
  /** Called when an item is selected. */
  onChange?: (item: DropdownItem) => void;
  /** Visual style variant. @default 'default' */
  variant?: DropdownVariant;
  /** Size. @default 'md' */
  size?: DropdownSize;
  /** Placeholder when no item is selected. @default 'Select...' */
  placeholder?: string;
  /** Disables the entire dropdown. */
  disabled?: boolean;
}

const TRIGGER_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  border: '1px solid',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1.4,
  textAlign: 'left',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

const TRIGGER_DISABLED: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const SIZE_STYLES: Record<DropdownSize, React.CSSProperties> = {
  sm: { fontSize: 12, padding: '5px 8px', minHeight: 28 },
  md: { fontSize: 14, padding: '8px 12px', minHeight: 36 },
  lg: { fontSize: 16, padding: '12px 16px', minHeight: 44 },
};

const ITEM_SIZE_STYLES: Record<DropdownSize, React.CSSProperties> = {
  sm: { fontSize: 12, padding: '5px 8px' },
  md: { fontSize: 14, padding: '8px 12px' },
  lg: { fontSize: 16, padding: '10px 16px' },
};

const VARIANT_TRIGGER: Record<DropdownVariant, React.CSSProperties> = {
  default: { borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' },
  primary: { borderColor: '#2563eb', backgroundColor: '#2563eb', color: '#ffffff' },
  danger: { borderColor: '#dc2626', backgroundColor: '#dc2626', color: '#ffffff' },
};

const VARIANT_FOCUS: Record<DropdownVariant, React.CSSProperties> = {
  default: { borderColor: '#6366f1', boxShadow: '0 0 0 2px rgba(99,102,241,0.15)' },
  primary: { boxShadow: '0 0 0 2px rgba(37,99,235,0.3)' },
  danger: { boxShadow: '0 0 0 2px rgba(220,38,38,0.3)' },
};

const ACTIVE_ITEM: Record<DropdownVariant, React.CSSProperties> = {
  default: { backgroundColor: '#f3f4f6' },
  primary: { backgroundColor: '#eff6ff', color: '#2563eb' },
  danger: { backgroundColor: '#fef2f2', color: '#dc2626' },
};

const MENU_BASE: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 50,
  marginTop: 4,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  backgroundColor: '#ffffff',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const ITEM_BASE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  border: 'none',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
  lineHeight: 1.4,
  textAlign: 'left',
  cursor: 'pointer',
  boxSizing: 'border-box',
  transition: 'background-color 0.1s',
};

const ITEM_DISABLED: React.CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};

const WRAPPER_BASE: React.CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const ELLIPSIS: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const CHEVRON: React.CSSProperties = {
  display: 'inline-block',
  border: 'solid currentColor',
  borderWidth: '0 2px 2px 0',
  padding: 3,
  transition: 'transform 0.15s',
  flexShrink: 0,
};

function findFirstEnabled(items: DropdownItem[], start = 0): number {
  for (let i = start; i < items.length; i++) {
    if (!items[i].disabled) return i;
  }
  for (let i = 0; i < start; i++) {
    if (!items[i].disabled) return i;
  }
  return -1;
}

function findLastEnabled(items: DropdownItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].disabled) return i;
  }
  return -1;
}

function findPrevEnabled(items: DropdownItem[], current: number): number {
  for (let i = current - 1; i >= 0; i--) {
    if (!items[i].disabled) return i;
  }
  return findLastEnabled(items);
}

function findNextEnabled(items: DropdownItem[], current: number): number {
  for (let i = current + 1; i < items.length; i++) {
    if (!items[i].disabled) return i;
  }
  return findFirstEnabled(items);
}

/** Reusable dropdown menu with full keyboard navigation and ARIA support. */
export const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(function Dropdown(
  {
    items,
    value,
    defaultValue,
    onChange,
    variant = 'default',
    size = 'md',
    placeholder = 'Select...',
    disabled = false,
    style,
    ...rest
  },
  ref,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');

  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internalValue;
  const selectedItem = items.find((item) => item.value === selectedValue);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = React.useId();

  function mergeRefs(node: HTMLDivElement | null) {
    wrapperRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref && typeof ref === 'object') {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
  }

  const activeDescendant = activeIndex >= 0 ? `${menuId}-item-${activeIndex}` : undefined;

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  function selectItem(item: DropdownItem) {
    if (item.disabled) return;
    if (!isControlled) {
      setInternalValue(item.value);
    }
    onChange?.(item);
    setIsOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }

  function handleTriggerClick() {
    if (disabled) return;
    setIsOpen((prev) => {
      if (!prev) {
        const idx = selectedItem ? items.indexOf(selectedItem) : -1;
        setActiveIndex(idx >= 0 ? idx : findFirstEnabled(items));
      } else {
        setActiveIndex(-1);
      }
      return !prev;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(findFirstEnabled(items));
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        triggerRef.current?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = findNextEnabled(items, prev >= 0 ? prev : -1);
          return next >= 0 ? next : prev;
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => {
          if (prev <= 0) {
            const last = findLastEnabled(items);
            return last >= 0 ? last : prev;
          }
          const next = findPrevEnabled(items, prev);
          return next >= 0 ? next : prev;
        });
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(findFirstEnabled(items));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(findLastEnabled(items));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < items.length) {
          selectItem(items[activeIndex]);
        }
        break;
    }
  }

  function handleItemClick(item: DropdownItem) {
    selectItem(item);
  }

  const chevronRotation = isOpen ? -135 : 45;

  return (
    <div
      ref={mergeRefs}
      style={{ ...WRAPPER_BASE, ...style } as React.CSSProperties}
      {...rest}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        style={{
          ...TRIGGER_BASE,
          ...SIZE_STYLES[size],
          ...VARIANT_TRIGGER[variant],
          ...(disabled ? TRIGGER_DISABLED : {}),
          ...(isOpen ? VARIANT_FOCUS[variant] : {}),
        }}
      >
        <span style={ELLIPSIS}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        <span
          aria-hidden="true"
          style={{
            ...CHEVRON,
            transform: `rotate(${chevronRotation}deg)`,
            marginTop: isOpen ? -1 : 1,
          }}
        />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-activedescendant={activeDescendant}
          style={MENU_BASE}
        >
          {items.map((item, index) => (
            <button
              key={item.value}
              id={`${menuId}-item-${index}`}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{
                ...ITEM_BASE,
                ...ITEM_SIZE_STYLES[size],
                ...(index === activeIndex ? ACTIVE_ITEM[variant] : {}),
                ...(item.disabled ? ITEM_DISABLED : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
