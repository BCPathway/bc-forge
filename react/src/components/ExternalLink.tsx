// SPDX-License-Identifier: MIT
import React from "react";
import { theme } from "../theme";

export interface ExternalLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  showIcon?: boolean;
}

/**
 * Anchor that always opens in a new tab with `rel="noopener noreferrer"`, so
 * the opened page cannot reach back into the dApp via `window.opener` (#1209).
 * Used for block-explorer links (e.g. Stellar Expert) off a transaction hash.
 */
export function ExternalLink({
  href,
  target = "_blank",
  rel,
  showIcon = true,
  children,
  style,
  ...rest
}: ExternalLinkProps) {
  const safeRel =
    target === "_blank"
      ? rel
        ? Array.from(
            new Set(`${rel} noopener noreferrer`.trim().split(/\s+/)),
          ).join(" ")
        : "noopener noreferrer"
      : rel;

  return (
    <a
      href={href}
      target={target}
      rel={safeRel}
      style={{ color: theme.primary, textDecoration: "underline", ...style }}
      {...rest}
    >
      {children ?? href}
      {showIcon ? (
        <span
          aria-hidden="true"
          style={{ display: "inline-block", marginInlineStart: 4 }}
        >
          ↗
        </span>
      ) : null}
    </a>
  );
}
