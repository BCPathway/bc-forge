// SPDX-License-Identifier: MIT
import React, { useEffect, useId, useState } from "react";
import { theme } from "../theme";
import { ExternalLink } from "./ExternalLink";

export interface TopNavigationItem {
  label: string;
  href: string;
  external?: boolean;
  current?: boolean;
  target?: React.HTMLAttributeAnchorTarget;
}

export interface TopNavigationBarProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "children"
> {
  brand: React.ReactNode;
  items: TopNavigationItem[];
  actions?: React.ReactNode;
  ariaLabel?: string;
  mobileBreakpoint?: number;
  menuLabel?: string;
}

const LINK_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "0 10px",
  borderRadius: 4,
  color: theme.text,
  fontSize: 14,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

export function TopNavigationBar({
  brand,
  items,
  actions,
  ariaLabel = "Main navigation",
  mobileBreakpoint = 768,
  menuLabel = "Toggle navigation menu",
  style,
  ...rest
}: TopNavigationBarProps) {
  const menuId = useId();
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(
      `(max-width: ${mobileBreakpoint - 1}px)`,
    );
    const update = () => {
      const nextIsMobile = mediaQuery
        ? mediaQuery.matches
        : window.innerWidth < mobileBreakpoint;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) setMenuOpen(false);
    };
    update();
    mediaQuery?.addEventListener("change", update);
    if (!mediaQuery) window.addEventListener("resize", update);
    return () => {
      mediaQuery?.removeEventListener("change", update);
      if (!mediaQuery) window.removeEventListener("resize", update);
    };
  }, [mobileBreakpoint]);

  const linkList = (
    <div
      id={menuId}
      style={{
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        flexDirection: isMobile ? "column" : "row",
        gap: 4,
        width: isMobile ? "100%" : "auto",
      }}
    >
      {items.map((item) => {
        const linkProps = {
          href: item.href,
          target: item.target,
          "aria-current": item.current ? ("page" as const) : undefined,
          style: {
            ...LINK_STYLE,
            ...(item.current
              ? { backgroundColor: theme.neutralBackground, fontWeight: 600 }
              : {}),
          },
        };
        return item.external || item.target === "_blank" ? (
          <ExternalLink key={`${item.href}-${item.label}`} {...linkProps}>
            {item.label}
          </ExternalLink>
        ) : (
          <a key={`${item.href}-${item.label}`} {...linkProps}>
            {item.label}
          </a>
        );
      })}
    </div>
  );

  return (
    <header
      {...rest}
      style={{
        position: "relative",
        zIndex: 20,
        width: "100%",
        boxSizing: "border-box",
        borderBottom: `1px solid ${theme.border}`,
        backgroundColor: theme.surface,
        color: theme.text,
        ...style,
      }}
    >
      <nav aria-label={ariaLabel}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minHeight: 60,
            padding: "8px 16px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              minWidth: 0,
            }}
          >
            <div style={{ flexShrink: 0 }}>{brand}</div>
            {isMobile ? null : linkList}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {actions}
            {isMobile ? (
              <button
                type="button"
                aria-label={menuLabel}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => setMenuOpen((open) => !open)}
                style={{
                  width: 40,
                  height: 40,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 4,
                  backgroundColor: theme.surface,
                  color: theme.text,
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                <span aria-hidden="true">{menuOpen ? "\u00d7" : "\u2630"}</span>
              </button>
            ) : null}
          </div>
        </div>
        {isMobile && menuOpen ? (
          <div style={{ padding: "0 16px 12px" }}>{linkList}</div>
        ) : null}
      </nav>
    </header>
  );
}
