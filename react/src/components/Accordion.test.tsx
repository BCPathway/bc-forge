// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Accordion, Collapsible } from "./Accordion";

describe("Collapsible", () => {
  it("toggles its panel and reports the new state", () => {
    const onOpenChange = jest.fn();
    render(
      <Collapsible
        title="Details"
        onOpenChange={onOpenChange}
        data-testid="disclosure"
      >
        Extra information
      </Collapsible>,
    );

    const trigger = screen.getByRole("button", { name: "Details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("disclosure")).toHaveAttribute(
      "data-testid",
      "disclosure",
    );
    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Extra information")).toBeVisible();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("respects a controlled open value", () => {
    render(
      <Collapsible title="Controlled" open={false}>
        Hidden content
      </Collapsible>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Controlled" }));
    expect(screen.getByText("Hidden content")).not.toBeVisible();
  });
});

describe("Accordion", () => {
  const items = [
    { id: "first", title: "First", content: "First content" },
    { id: "second", title: "Second", content: "Second content" },
  ];

  it("allows one item open at a time by default", () => {
    render(<Accordion items={items} />);

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByText("First content")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Second" }));

    expect(screen.getByText("First content")).not.toBeVisible();
    expect(screen.getByText("Second content")).toBeVisible();
  });

  it("supports multiple expanded items", () => {
    render(<Accordion items={items} multiple />);

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    fireEvent.click(screen.getByRole("button", { name: "Second" }));

    expect(screen.getByText("First content")).toBeVisible();
    expect(screen.getByText("Second content")).toBeVisible();
  });
});
