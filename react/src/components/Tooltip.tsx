import React, { cloneElement, useId, useState } from 'react';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: TooltipPlacement;
}

const PLACEMENT_STYLES: Record<TooltipPlacement, React.CSSProperties> = {
  top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
  bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
  left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
  right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
};

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 50,
  whiteSpace: 'nowrap',
  borderRadius: 6,
  background: '#111827',
  color: '#ffffff',
  fontSize: 12,
  padding: '4px 8px',
  pointerEvents: 'none',
};

/** Accessible tooltip shown on hover and keyboard focus, dismissible with Escape. */
export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open ? (
        <span role="tooltip" id={id} style={{ ...tooltipStyle, ...PLACEMENT_STYLES[placement] }}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
