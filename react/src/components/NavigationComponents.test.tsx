// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Breadcrumbs } from "./Breadcrumbs";
import { Button } from "./Button";
import { Footer } from "./Footer";
import { SegmentedControl } from "./SegmentedControl";
import { Tabs } from "./Tabs";

describe("navigation and control components", () => {
  it("renders linked breadcrumbs and marks the current page", () => {
    render(
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Vaults" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText("Vaults")).toHaveAttribute("aria-current", "page");
  });

  it("renders network latency with threshold status", () => {
    render(
      <Footer network="Testnet" latencyMs={420} latencyWarningMs={300}>
        Build 42
      </Footer>,
    );
    expect(screen.getByText("Build 42")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Testnet network latency" }),
    ).toHaveTextContent("420 ms");
  });

  it("disables a loading button and exposes its busy state", () => {
    render(
      <Button loading loadingText="Saving...">
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("changes tabs by click and keyboard navigation", () => {
    render(
      <Tabs
        items={[
          { label: "Overview", value: "overview", content: "Overview panel" },
          { label: "Activity", value: "activity", content: "Activity panel" },
        ]}
      />,
    );
    const overview = screen.getByRole("tab", { name: "Overview" });
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
  });

  it("updates the selected segmented option", () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        ariaLabel="Display mode"
        options={[
          { label: "List", value: "list" },
          { label: "Grid", value: "grid" },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(onChange).toHaveBeenCalledWith("grid");
  });
});
