// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ExternalLink } from "./ExternalLink";

describe("ExternalLink", () => {
  it("opens external destinations safely in a new tab", () => {
    render(
      <ExternalLink
        href="https://stellar.expert/explorer/testnet/tx/ABC"
        rel="nofollow"
      >
        View transaction
      </ExternalLink>,
    );

    const link = screen.getByRole("link", { name: "View transaction" });
    expect(link).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/ABC",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "nofollow noopener noreferrer");
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent("↗");
  });

  it("opens in a new tab without leaking window.opener", () => {
    render(
      <ExternalLink href="https://stellar.expert/explorer/testnet/tx/ABC">
        ABC
      </ExternalLink>,
    );

    const link = screen.getByRole("link", { name: "ABC" });
    expect(link).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/ABC",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("falls back to the href as its label", () => {
    render(
      <ExternalLink href="https://stellar.expert/explorer/testnet/tx/ABC" />,
    );
    expect(screen.getByRole("link")).toHaveTextContent(
      "https://stellar.expert/explorer/testnet/tx/ABC",
    );
  });

  it("does not add new-tab security rel values for same-tab links", () => {
    render(
      <ExternalLink
        href="/explorer"
        target="_self"
        rel="nofollow"
        showIcon={false}
      >
        Explorer
      </ExternalLink>,
    );

    expect(screen.getByRole("link", { name: "Explorer" })).toHaveAttribute(
      "rel",
      "nofollow",
    );
  });
});
