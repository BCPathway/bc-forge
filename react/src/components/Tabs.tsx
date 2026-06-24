import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useId,
} from 'react';

export type TabsVariant = 'underline' | 'pills' | 'tabs';

export type TabsSize = 'sm' | 'md' | 'lg';

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Visual variant. @default 'underline' */
  variant?: TabsVariant;
  /** Size of tab triggers. @default 'md' */
  size?: TabsSize;
  /** Controlled active tab value. */
  value?: string;
  /** Initial active tab value (uncontrolled). */
  defaultValue?: string;
  /** Called when the active tab changes. */
  onChange?: (value: string) => void;
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface TabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** The unique value identifying this tab. */
  value: string;
}

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The value of the tab this panel is associated with. */
  value: string;
}

interface TabsContextValue {
  activeValue: string;
  onChange: (value: string) => void;
  variant: TabsVariant;
  size: TabsSize;
  baseId: string;
  tabValues: React.MutableRefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error('Tabs compound components must be used within <Tabs>.');
  }
  return ctx;
}

const TABLIST_STYLES: Record<TabsVariant, React.CSSProperties> = {
  underline: { display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb' },
  pills: { display: 'flex', gap: 4, padding: 4 },
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', paddingLeft: 4 },
};

const TAB_SIZE_STYLES: Record<TabsSize, React.CSSProperties> = {
  sm: { padding: '4px 12px', fontSize: 13, lineHeight: '18px' },
  md: { padding: '8px 16px', fontSize: 14, lineHeight: '20px' },
  lg: { padding: '12px 24px', fontSize: 16, lineHeight: '24px' },
};

const ACTIVE_TAB: Record<TabsVariant, React.CSSProperties> = {
  underline: {
    borderBottom: '2px solid #3b82f6',
    marginBottom: -2,
    color: '#3b82f6',
    fontWeight: 600,
  },
  pills: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    borderRadius: 6,
    fontWeight: 600,
  },
  tabs: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderBottom: '1px solid #ffffff',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginBottom: -1,
    color: '#3b82f6',
    fontWeight: 600,
  },
};

const INACTIVE_TAB: Record<TabsVariant, React.CSSProperties> = {
  underline: {
    borderBottom: '2px solid transparent',
    marginBottom: -2,
    color: '#6b7280',
    fontWeight: 400,
    cursor: 'pointer',
  },
  pills: {
    backgroundColor: 'transparent',
    color: '#6b7280',
    borderRadius: 6,
    fontWeight: 400,
    cursor: 'pointer',
  },
  tabs: {
    backgroundColor: '#f9fafb',
    border: '1px solid transparent',
    borderBottom: '1px solid #e5e7eb',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginBottom: -1,
    color: '#6b7280',
    fontWeight: 400,
    cursor: 'pointer',
  },
};

const TAB_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'none',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
};

// ─── Root ─────────────────────────────────────────────────────────────────────

function TabsRoot(
  {
    variant = 'underline',
    size = 'md',
    value: controlledValue,
    defaultValue = '',
    onChange,
    children,
    ...rest
  }: TabsProps,
  ref: React.Ref<HTMLDivElement>,
) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const activeValue = isControlled ? controlledValue : internalValue;
  const baseId = useId();
  const tabValues = useRef<string[]>([]);

  const handleChange = useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);
    },
    [isControlled, onChange],
  );

  const context = useMemo<TabsContextValue>(
    () => ({ activeValue, onChange: handleChange, variant, size, baseId, tabValues }),
    [activeValue, handleChange, variant, size, baseId],
  );

  return (
    <TabsContext.Provider value={context}>
      <div ref={ref} {...rest}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

// ─── TabList ───────────────────────────────────────────────────────────────────

const TabList = forwardRef<HTMLDivElement, TabsListProps>(function TabList(
  { children, style, ...rest },
  ref,
) {
  const { variant } = useTabsContext();

  return (
    <div ref={ref} role="tablist" style={{ ...TABLIST_STYLES[variant], ...style }} {...rest}>
      {children}
    </div>
  );
});

// ─── Tab ───────────────────────────────────────────────────────────────────────

const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, children, onClick, onKeyDown, style, ...rest },
  forwardedRef,
) {
  const { activeValue, onChange, variant, size, baseId, tabValues } = useTabsContext();
  const isActive = activeValue === value;

  const handleRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element && !tabValues.current.includes(value)) {
        tabValues.current.push(value);
      }
      if (typeof forwardedRef === 'function') {
        forwardedRef(element);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLButtonElement | null>).current = element;
      }
    },
    [value, tabValues, forwardedRef],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        onChange(value);
      }
    },
    [onClick, onChange, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      const values = tabValues.current;
      if (values.length === 0) return;

      const currentIndex = values.indexOf(value);
      let nextIndex = -1;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % values.length;
          break;
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + values.length) % values.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = values.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      onChange(values[nextIndex]);
    },
    [onKeyDown, tabValues, value, onChange],
  );

  const panelId = `${baseId}-panel-${value}`;
  const tabId = `${baseId}-tab-${value}`;

  return (
    <button
      ref={handleRef}
      role="tab"
      id={tabId}
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        ...TAB_BASE,
        ...TAB_SIZE_STYLES[size],
        ...(isActive ? ACTIVE_TAB[variant] : INACTIVE_TAB[variant]),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
});

// ─── TabPanel ──────────────────────────────────────────────────────────────────

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { value, children, style, ...rest },
  ref,
) {
  const { activeValue, baseId } = useTabsContext();
  const isActive = activeValue === value;
  const panelId = `${baseId}-panel-${value}`;
  const tabId = `${baseId}-tab-${value}`;

  return (
    <div
      ref={ref}
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={!isActive}
      style={{ padding: 16, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
});

// ─── Compound component ───────────────────────────────────────────────────────

export interface TabsCompound
  extends React.ForwardRefExoticComponent<TabsProps & React.RefAttributes<HTMLDivElement>> {
  List: typeof TabList;
  Tab: typeof Tab;
  Panel: typeof TabPanel;
}

export const Tabs: TabsCompound = Object.assign(
  forwardRef<HTMLDivElement, TabsProps>(TabsRoot),
  { List: TabList, Tab, Panel: TabPanel },
);
