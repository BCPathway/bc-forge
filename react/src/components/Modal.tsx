import React, { useEffect, useRef } from "react";

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "danger";
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = "md",
  variant = "default",
  children,
  className = "",
  ...props
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle keyboard events: Escape key & Focus Trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        if (e.shiftKey) {
          // Shift + Tab: Go backward
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          // Tab: Go forward
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    // Store current active element to restore it when modal closes
    const previousActiveElement = document.activeElement as HTMLElement;

    document.addEventListener("keydown", handleKeyDown);
    
    // Auto-focus the modal container or first focusable element on mount
    if (modalRef.current) {
      const firstInput = modalRef.current.querySelector(
        'button, input, select, textarea'
      ) as HTMLElement;
      if (firstInput) {
        firstInput.focus();
      } else {
        modalRef.current.focus();
      }
    }

    // Lock body scroll while modal is visible
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
      if (previousActiveElement) {
        previousActiveElement.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Structural design tokens
  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-3xl",
  };

  const headerBorderClasses = variant === "danger" 
    ? "border-l-4 border-red-500" 
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`w-full bg-white rounded-lg shadow-xl overflow-hidden transform transition-all p-6 focus:outline-none ${sizeClasses[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {/* Header Section */}
        <div className={`flex items-start justify-between pb-3 mb-4 border-b border-gray-200 ${headerBorderClasses}`}>
          <h3 id="modal-title" className="text-xl font-semibold text-gray-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded p-1"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body Section */}
        <div className="text-sm text-gray-500">
          {children}
        </div>
      </div>
    </div>
  );
};