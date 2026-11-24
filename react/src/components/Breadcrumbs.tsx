// SPDX-License-Identifier: MIT
import React, { forwardRef } from "react";
import { theme } from "../theme";

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  ariaLabel?: string;
  separator?: React.ReactNode;
}

export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(
  function Breadcrumbs(
    { items, ariaLabel = "Breadcrumb", separator = "/", style, ...rest },
    ref,
  ) {
    return (
      <nav
        ref={ref}
        aria-label={ariaLabel}
        style={{ color: theme.neutralText, fontSize: 14, ...style }}
        {...rest}
      >
        <ol
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
        >
          {items.map((item, index) => {
            const isCurrent = index === items.length - 1;
            return (
              <li
                key={`${index}-${String(item.label)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                {index > 0 ? <span aria-hidden="true">{separator}</span> : null}
                {item.href && !isCurrent ? (
                  <a
                    href={item.href}
                    style={{ color: theme.primary, textDecoration: "none" }}
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    aria-current={isCurrent ? "page" : undefined}
                    style={{ color: isCurrent ? theme.text : undefined }}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  },
);
