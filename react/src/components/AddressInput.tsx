// SPDX-License-Identifier: MIT
import React, { forwardRef, useId, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { theme } from "../theme";

export interface AddressInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "onChange" | "value"
> {
  /** Current address for controlled use. */
  value?: string;
  /** Initial address for uncontrolled use. */
  defaultValue?: string;
  /** Called when the address text changes. */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

function isValidStellarAddress(address: string): boolean {
  if (address.startsWith("G")) return StrKey.isValidEd25519PublicKey(address);
  if (address.startsWith("C")) return StrKey.isValidContract(address);
  return false;
}

/** Text input that validates Stellar account and contract StrKeys as the user types. */
export const AddressInput = forwardRef<HTMLInputElement, AddressInputProps>(
  function AddressInput(
    { value, defaultValue = "", onChange, id, style, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const address = value ?? uncontrolledValue;
    const hasValue = address.length > 0;
    const valid = hasValue && isValidStellarAddress(address);
    const errorId = `${inputId}-error`;
    const describedBy =
      [rest["aria-describedby"], hasValue && !valid ? errorId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;

    const handleChange: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      if (value === undefined) setUncontrolledValue(event.currentTarget.value);
      onChange?.(event);
    };

    return (
      <div>
        <div style={{ position: "relative" }}>
          <input
            {...rest}
            ref={ref}
            id={inputId}
            type="text"
            value={address}
            onChange={handleChange}
            aria-invalid={hasValue && !valid}
            aria-describedby={describedBy}
            style={{
              boxSizing: "border-box",
              width: "100%",
              padding: "8px 36px 8px 12px",
              border: `1px solid ${hasValue && !valid ? theme.danger : theme.border}`,
              borderRadius: 6,
              backgroundColor: theme.surface,
              color: theme.text,
              font: "inherit",
              ...style,
            }}
          />
          {valid ? (
            <span
              role="status"
              aria-label="Valid Stellar address"
              style={{
                position: "absolute",
                top: "50%",
                right: 12,
                transform: "translateY(-50%)",
                color: theme.successText,
              }}
            >
              ✓
            </span>
          ) : null}
        </div>
        {hasValue && !valid ? (
          <div
            id={errorId}
            role="alert"
            style={{ marginTop: 4, color: theme.danger, fontSize: 12 }}
          >
            Enter a valid Stellar public key (G...) or contract address (C...).
          </div>
        ) : null}
      </div>
    );
  },
);

AddressInput.displayName = "AddressInput";
