// SPDX-License-Identifier: MIT
import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Modal,
  type ModalProps,
  type ModalSize,
} from "../src/components/Modal";

const CONFIRM_STYLE = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const meta = {
  title: "Primitives/Modal",
  component: Modal,
  args: {
    open: true,
    // `onClose` is required on `ModalProps`, so supplying it here keeps Storybook
    // from inferring `args` as required on every individual story. The harness
    // overrides it with its own state-backed handler.
    onClose: () => {},
    title: "Confirm deposit",
    description: "Deposits cannot be reversed once submitted.",
    closeOnBackdropClick: true,
    closeOnEscape: true,
  },
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Story-scoped harness owning the open/closed state.
 *
 * The state lives in a component rather than directly inside each `render`,
 * because `render` is not a component: calling a hook in it breaks the rules of
 * hooks and fails to typecheck against Storybook's `StoryFnRender` signature.
 */
function ModalHarness({
  initialOpen,
  triggerLabel,
  children,
  ...modalProps
}: Omit<ModalProps, "open" | "onClose"> & {
  /** Whether the dialog is open on the first render. */
  initialOpen: boolean;
  /** Label of the button that opens the dialog. */
  triggerLabel: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <Modal {...modalProps} open={open} onClose={() => setOpen(false)}>
        {children}
      </Modal>
    </>
  );
}

/** Open on load, dismissible from the backdrop, Escape or the close button. */
export const WithDescription: Story = {
  render: ({ open, ...rest }) => (
    <ModalHarness {...rest} initialOpen={open} triggerLabel="Open dialog">
      <p style={{ margin: 0, fontSize: 14 }}>
        The contract works in the smallest indivisible unit, so this dialog
        never rescales the amount for you.
      </p>
    </ModalHarness>
  ),
};

/** A confirmation flow with the actions under the body. */
export const WithFooter: Story = {
  render: ({ open, footer, ...rest }) => (
    <ModalHarness
      {...rest}
      initialOpen={open}
      triggerLabel="Review deposit"
      footer={
        footer ?? (
          <>
            <button type="button">Cancel</button>
            <button type="button" style={CONFIRM_STYLE}>
              Confirm
            </button>
          </>
        )
      }
    >
      <p style={{ margin: 0, fontSize: 14 }}>1,000,000 base units</p>
    </ModalHarness>
  ),
};

/** Opens the dialog at each of the three width presets. */
export const Sizes: Story = {
  render: ({ open, size, title, ...rest }) => (
    <SizesHarness
      {...rest}
      initialOpen={open}
      initialSize={size ?? "md"}
      title={title}
    />
  ),
};

/** Locked down to the close button: no Escape, no backdrop dismissal. */
export const NonDismissible: Story = {
  render: ({ open, ...rest }) => (
    <ModalHarness
      {...rest}
      initialOpen={open}
      triggerLabel="Reconnect"
      title="Session expired"
      description="Reconnect your wallet to continue."
      closeOnBackdropClick={false}
      closeOnEscape={false}
    >
      <button type="button" style={CONFIRM_STYLE}>
        Reconnect
      </button>
    </ModalHarness>
  ),
};

/**
 * Width-switching variant: the size is chosen by the trigger buttons rather
 * than fixed, so it needs its own state instead of the shared harness.
 */
function SizesHarness({
  initialOpen,
  initialSize,
  title,
  ...modalProps
}: Omit<ModalProps, "open" | "size" | "onClose"> & {
  initialOpen: boolean;
  initialSize: ModalSize;
  title?: ReactNode;
}) {
  const [size, setSize] = useState<ModalSize | null>(
    initialOpen ? initialSize : null,
  );
  return (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        {(["sm", "md", "lg"] as const).map((option) => (
          <button key={option} type="button" onClick={() => setSize(option)}>
            {option}
          </button>
        ))}
      </div>
      <Modal
        {...modalProps}
        open={size !== null}
        onClose={() => setSize(null)}
        size={size ?? "md"}
        title={title ?? `Width: ${size ?? "md"}`}
      >
        <p style={{ margin: 0, fontSize: 14 }}>
          Reopen at another width to compare the presets.
        </p>
      </Modal>
    </>
  );
}
