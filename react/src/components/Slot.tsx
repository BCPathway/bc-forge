import React from 'react';

interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

export const Slot = React.forwardRef<HTMLElement, SlotProps>(
  ({ children, ...props }, ref) => {
    if (React.isValidElement(children)) {
      const childProps = children.props as Record<string, unknown>;
      const mergedStyle = {
        ...(props.style as React.CSSProperties || {}),
        ...(childProps.style as React.CSSProperties || {}),
      };

      const mergedClassName = [props.className, childProps.className]
        .filter(Boolean)
        .join(' ');

      return React.cloneElement(children, {
        ...props,
        style: mergedStyle,
        className: mergedClassName || undefined,
        ref: (node: HTMLElement) => {
          const childRef = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = node;
          if (typeof childRef === 'function') childRef(node);
          else if (childRef) (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
        },
      } as React.HTMLAttributes<HTMLElement>);
    }

    return <>{children}</>;
  },
);

Slot.displayName = 'Slot';
