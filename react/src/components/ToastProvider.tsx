// SPDX-License-Identifier: MIT
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { theme } from "../theme";

export type ToastVariant = "info" | "success" | "warning" | "error";
export type ToastPosition =
  "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface ToastOptions {
  message: React.ReactNode;
  title?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  defaultDuration?: number;
  position?: ToastPosition;
}

interface ToastEntry extends ToastOptions {
  id: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, React.CSSProperties> = {
  info: {
    backgroundColor: theme.primaryBackground,
    borderColor: theme.primaryBorder,
    color: theme.primaryText,
  },
  success: {
    backgroundColor: theme.successBackground,
    borderColor: theme.successBorder,
    color: theme.successText,
  },
  warning: {
    backgroundColor: theme.warningBackground,
    borderColor: theme.warningBorder,
    color: theme.warningText,
  },
  error: {
    backgroundColor: theme.dangerBackground,
    borderColor: theme.dangerBorder,
    color: theme.dangerText,
  },
};

const POSITION_STYLES: Record<ToastPosition, React.CSSProperties> = {
  "top-right": { top: 16, right: 16 },
  "top-left": { top: 16, left: 16 },
  "bottom-right": { bottom: 16, right: 16 },
  "bottom-left": { bottom: 16, left: 16 },
};

export function ToastProvider({
  children,
  defaultDuration = 5000,
  position = "top-right",
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const dismissAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setToasts([]);
  };

  const showToast = (options: ToastOptions) => {
    const id = `toast-${nextId.current++}`;
    const toast: ToastEntry = {
      ...options,
      id,
      variant: options.variant ?? "info",
    };
    setToasts((current) => [...current, toast]);

    const duration = options.duration ?? defaultDuration;
    if (duration > 0) {
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), duration),
      );
    }
    return id;
  };

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, dismissAll }}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        data-testid="toast-viewport"
        style={{
          position: "fixed",
          zIndex: 1000,
          display: "flex",
          flexDirection: position.startsWith("top")
            ? "column"
            : "column-reverse",
          gap: 10,
          width: "min(420px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
          ...POSITION_STYLES[position],
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={
              toast.variant === "error" || toast.variant === "warning"
                ? "alert"
                : "status"
            }
            aria-live={
              toast.variant === "error" || toast.variant === "warning"
                ? "assertive"
                : "polite"
            }
            data-toast-id={toast.id}
            data-variant={toast.variant}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid",
              borderRadius: 6,
              boxShadow: `0 4px 12px ${theme.shadow}`,
              fontSize: 14,
              ...VARIANT_STYLES[toast.variant],
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {toast.title ? (
                <div style={{ marginBottom: 2, fontWeight: 700 }}>
                  {toast.title}
                </div>
              ) : null}
              <div>{toast.message}</div>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              style={{
                flexShrink: 0,
                padding: 0,
                border: 0,
                background: "transparent",
                color: "inherit",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context)
    throw new Error("useToast must be used within a ToastProvider.");
  return context;
}
