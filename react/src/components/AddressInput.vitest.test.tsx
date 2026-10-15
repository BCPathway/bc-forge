// SPDX-License-Identifier: MIT
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { StrKey } from "@stellar/stellar-sdk";
import { AddressInput } from "./AddressInput";

describe("AddressInput", () => {
  it("shows inline validation for an invalid address", () => {
    render(<AddressInput aria-label="Stellar address" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "not-an-address" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid Stellar",
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2)),
    StrKey.encodeContract(Buffer.alloc(32, 1)),
  ])("accepts a checksummed Stellar address", (address) => {
    render(<AddressInput aria-label="Stellar address" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: address },
    });
    expect(
      screen.getByRole("status", { name: "Valid Stellar address" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  it("supports controlled values and change callbacks", () => {
    const onChange = vi.fn();
    render(
      <AddressInput
        aria-label="Stellar address"
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ginvalid" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
