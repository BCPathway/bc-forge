// SPDX-License-Identifier: MIT
import React from "react";
import "./Skeleton.css";

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of placeholder lines. @default 3 */
  lines?: number;
  /** Width of the final line. @default '70%' */
  lastLineWidth?: React.CSSProperties["width"];
}

export interface SkeletonCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Diameter of the circle. @default 40 */
  size?: number | string;
}

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The card's placeholder layout is fixed and does not accept children. */
  children?: never;
}

/** Animated text-line placeholder for loading content. */
export function SkeletonText({
  lines = 3,
  lastLineWidth = "70%",
  className,
  style,
  ...rest
}: SkeletonTextProps) {
  return (
    <div
      aria-hidden="true"
      className={["bc-forge-skeleton-text", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...rest}
    >
      {Array.from({ length: Math.max(0, Math.floor(lines)) }, (_, index) => (
        <div
          className="bc-forge-skeleton"
          key={index}
          style={
            index === Math.floor(lines) - 1
              ? { width: lastLineWidth }
              : undefined
          }
        />
      ))}
    </div>
  );
}

/** Animated circular placeholder, commonly used for avatars. */
export function SkeletonCircle({
  size = 40,
  className,
  style,
  ...rest
}: SkeletonCircleProps) {
  return (
    <div
      aria-hidden="true"
      className={["bc-forge-skeleton", "bc-forge-skeleton-circle", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  );
}

/** Card-shaped placeholder with avatar, text lines, and a content block. */
export function SkeletonCard({ className, style, ...rest }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={["bc-forge-skeleton-card", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...rest}
    >
      <div className="bc-forge-skeleton-card-header">
        <SkeletonCircle size={40} />
        <SkeletonText lines={2} lastLineWidth="55%" />
      </div>
      <div className="bc-forge-skeleton bc-forge-skeleton-card-content" />
    </div>
  );
}
