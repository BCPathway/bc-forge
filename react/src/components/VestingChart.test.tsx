// SPDX-License-Identifier: MIT
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { VestingChart, computeVestingMetrics } from "./VestingChart";
import * as reactEntry from "../index";

describe("computeVestingMetrics", () => {
  it("returns 0 vested before cliff", () => {
    const m = computeVestingMetrics(1000n, 0n, 100, 500, 50);
    expect(m.vestedAmount).toBe(0n);
    expect(m.claimableAmount).toBe(0n);
    expect(m.lockedAmount).toBe(1000n);
    expect(m.isBeforeCliff).toBe(true);
    expect(m.isFullyVested).toBe(false);
  });

  it("computes linear vesting between cliff and end", () => {
    const m = computeVestingMetrics(1000n, 200n, 100, 500, 300);
    expect(m.vestedAmount).toBe(500n);
    expect(m.claimedAmount).toBe(200n);
    expect(m.claimableAmount).toBe(300n);
    expect(m.lockedAmount).toBe(500n);
    expect(m.vestedPercent).toBe(50);
  });

  it("caps vested amount at totalAmount after endLedger", () => {
    const m = computeVestingMetrics(1000n, 400n, 100, 500, 700);
    expect(m.vestedAmount).toBe(1000n);
    expect(m.claimableAmount).toBe(600n);
    expect(m.lockedAmount).toBe(0n);
    expect(m.isFullyVested).toBe(true);
  });
});

describe("VestingChart", () => {
  const defaultProps = {
    totalAmount: 1000n,
    releasedAmount: 200n,
    cliffLedger: 100,
    endLedger: 500,
    currentLedger: 300,
  };

  it("is exported from react/src/index.ts", () => {
    expect(reactEntry.VestingChart).toBe(VestingChart);
  });

  it("renders responsive SVG with cliff marker, unlock slope, and claimed/claimable zones", () => {
    render(<VestingChart {...defaultProps} />);

    const svg = screen.getByRole("img", { name: "Vesting Schedule" });
    expect(svg).toHaveAttribute("viewBox", "0 0 640 260");
    expect(svg).toHaveStyle({ width: "100%", height: "auto" });

    expect(screen.getByTestId("vesting-cliff-marker")).toBeInTheDocument();
    expect(screen.getByTestId("vesting-unlock-slope")).toBeInTheDocument();
    expect(screen.getByTestId("vesting-claimed-zone")).toBeInTheDocument();
    expect(screen.getByTestId("vesting-claimable-zone")).toBeInTheDocument();
    expect(screen.getByTestId("vesting-current-marker")).toBeInTheDocument();
  });

  it("displays claimed, claimable, and locked breakdown in legend", () => {
    render(<VestingChart {...defaultProps} />);

    expect(screen.getByText(/Claimed: 200/)).toBeInTheDocument();
    expect(screen.getByText(/Claimable: 300/)).toBeInTheDocument();
    expect(screen.getByText(/Locked: 500/)).toBeInTheDocument();
    expect(screen.getByText(/50% vested/)).toBeInTheDocument();
  });

  it("omits claimed and claimable zones before cliff when nothing is released", () => {
    render(
      <VestingChart
        totalAmount={1000n}
        releasedAmount={0n}
        cliffLedger={100}
        endLedger={500}
        currentLedger={50}
      />,
    );

    expect(screen.queryByTestId("vesting-claimed-zone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vesting-claimable-zone")).not.toBeInTheDocument();
    expect(screen.getByText(/0% vested/)).toBeInTheDocument();
  });

  it("updates accessible tooltip on hover and keyboard focus", () => {
    render(<VestingChart {...defaultProps} />);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(/Hover or focus a milestone marker/);

    const cliffPoint = screen.getByTestId("vesting-point-cliff");
    fireEvent.mouseEnter(cliffPoint);
    expect(tooltip).toHaveTextContent(/Cliff at ledger #100/);

    fireEvent.mouseLeave(cliffPoint);
    expect(tooltip).toHaveTextContent(/Hover or focus a milestone marker/);

    const currentPoint = screen.getByTestId("vesting-point-current");
    fireEvent.focus(currentPoint);
    expect(tooltip).toHaveTextContent(/Ledger #300: 500 vested \(50%\)/);

    fireEvent.blur(currentPoint);
    expect(tooltip).toHaveTextContent(/Hover or focus a milestone marker/);
  });

  it("provides accessible ARIA attributes on SVG and interactive markers", () => {
    render(<VestingChart {...defaultProps} title="Team Vesting" />);

    const section = screen.getByRole("region", { name: "Team Vesting" });
    expect(section).toBeInTheDocument();

    const svg = screen.getByRole("img", { name: "Team Vesting" });
    expect(svg).toHaveAttribute("aria-describedby");

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("tabindex", "0");
      expect(btn).toHaveAttribute("aria-label");
    });
  });
});
