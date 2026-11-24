// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TopNavigationBar } from "./TopNavigationBar";

describe("TopNavigationBar", () => {
  const items = [
    { label: "Vaults", href: "/vaults", current: true },
    { label: "Explorer", href: "https://stellar.expert", external: true },
    { label: "Docs", href: "/docs", target: "_blank" as const },
  ];

  it("renders navigation links on wide screens", () => {
    setMatchMedia(false);
    render(<TopNavigationBar brand="BC Forge" items={items} />);

    expect(screen.getByRole("link", { name: "Vaults" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Explorer" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(
      screen.queryByRole("button", { name: "Toggle navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("collapses links behind a mobile menu toggle", () => {
    setMatchMedia(true);
    render(<TopNavigationBar brand="BC Forge" items={items} />);

    const toggle = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: "Vaults" }),
    ).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Vaults" })).toBeInTheDocument();
  });
});

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: jest.fn(() => ({
      matches,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}
