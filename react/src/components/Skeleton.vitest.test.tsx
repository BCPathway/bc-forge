// SPDX-License-Identifier: MIT
import React from "react";
import { render, screen } from "@testing-library/react";
import { SkeletonCard, SkeletonCircle, SkeletonText } from "./Skeleton";

describe("Skeleton primitives", () => {
  it("renders the requested number of text lines as decorative content", () => {
    render(<SkeletonText lines={4} data-testid="skeleton-text" />);
    expect(screen.getByTestId("skeleton-text").children).toHaveLength(4);
    expect(screen.getByTestId("skeleton-text")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("uses the requested circle size", () => {
    render(<SkeletonCircle size={56} data-testid="skeleton-circle" />);
    expect(screen.getByTestId("skeleton-circle")).toHaveStyle({
      width: "56px",
      height: "56px",
    });
  });

  it("renders the card placeholder", () => {
    render(<SkeletonCard data-testid="skeleton-card" />);
    expect(screen.getByTestId("skeleton-card")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
