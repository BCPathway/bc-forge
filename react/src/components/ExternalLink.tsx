// SPDX-License-Identifier: MIT
import React from "react";

export interface ExternalLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  showIcon?: boolean;
}

export function ExternalLink({
  target = "_blank",
  rel,
  showIcon = true,
  children,
  ...rest
}: ExternalLinkProps) {
  const safeRel =
    target === "_blank"
      ? Array.from(
          new Set(`${rel ?? ""} noopener noreferrer`.trim().split(/\s+/)),
        ).join(" ")
      : rel;

  return (
    <a {...rest} target={target} rel={safeRel}>
      {children}
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
