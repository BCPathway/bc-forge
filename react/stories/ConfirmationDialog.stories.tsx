// SPDX-License-Identifier: MIT
import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  ConfirmationDialog,
  type ConfirmationDialogProps,
} from "../src/components/ConfirmationDialog";

const meta = {
  title: "Primitives/ConfirmationDialog",
  component: ConfirmationDialog,
  args: {
    open: true,
    title: "Burn 1,000 BCC?",
    description:
      "This supply is removed from circulation forever. There is no way to undo it.",
    confirmLabel: "Burn supply",
    cancelLabel: "Keep supply",
    onClose: () => {},
    onConfirm: () => {},
  },
} satisfies Meta<typeof ConfirmationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

interface HarnessProps extends Partial<ConfirmationDialogProps> {
  /** Extra content rendered between the description and the gate. */
  children?: ReactNode;
}

/**
 * Story-scoped harness so the dialog can actually be closed and reopened.
 *
 * The dialog normally portals into `document.body`, which would put it outside
 * the story frame: the `play` functions could not reach it through
 * `canvasElement`, and the visual baseline would only capture the trigger. The
 * harness therefore gives it a stage *inside* the story and passes that as
 * `portalContainer`.
 *
 * The stage carries a `transform`, which establishes a containing block for the
 * dialog's `position: fixed` backdrop — without it the backdrop would still size
 * itself to the viewport and paint over the whole page.
 */
function Harness({ children, ...args }: HarnessProps) {
  const [open, setOpen] = useState(args.open ?? true);
  const [lastAction, setLastAction] = useState("none");
  const [stage, setStage] = useState<HTMLDivElement | null>(null);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        type="button"
        data-testid="open-dialog"
        onClick={() => setOpen(true)}
        style={{
          justifySelf: "start",
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: "#ffffff",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        Open dialog
      </button>
      <span
        data-testid="last-action"
        style={{ fontSize: 13, color: "#374151" }}
      >
        Last action: {lastAction}
      </span>
      <div
        ref={setStage}
        data-testid="dialog-stage"
        style={{
          position: "relative",
          transform: "translateZ(0)",
          minHeight: 340,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      <ConfirmationDialog
        {...args}
        open={open}
        portalContainer={stage}
        title={args.title ?? "Confirm this action"}
        onClose={() => {
          setLastAction("cancelled");
          setOpen(false);
          args.onClose?.();
        }}
        onConfirm={() => {
          setLastAction("confirmed");
          setOpen(false);
          args.onConfirm?.();
        }}
      >
        {children}
      </ConfirmationDialog>
    </div>
  );
}

export const BurnSupply: Story = {
  render: (args) => (
    <Harness {...args}>
      <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>
        Recipient: GABC…7Y8Z
      </p>
    </Harness>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const confirm = canvas.getByTestId("confirmation-dialog-confirm");
    await expect(confirm).toBeDisabled();

    await userEvent.click(canvas.getByTestId("confirmation-dialog-checkbox"));
    await expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    await expect(canvas.getByTestId("last-action")).toHaveTextContent(
      "Last action: confirmed",
    );
  },
};

export const KeywordGate: Story = {
  args: {
    title: "Revoke the admin role?",
    description:
      "You will lose the ability to mint, pause or upgrade the contract.",
    confirmLabel: "Revoke role",
    confirmationMode: "keyword",
    confirmationKeyword: "REVOKE",
  },
  render: (args) => <Harness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const confirm = canvas.getByTestId("confirmation-dialog-confirm");
    await expect(confirm).toBeDisabled();

    await userEvent.type(
      canvas.getByTestId("confirmation-dialog-keyword-input"),
      "revoke",
    );
    await expect(confirm).toBeEnabled();
  },
};

export const WarningVariant: Story = {
  args: {
    title: "Pause all transfers?",
    description:
      "Users will not be able to move tokens until the contract is unpaused.",
    confirmLabel: "Pause contract",
    variant: "warning",
    confirmationMode: "none",
  },
  render: (args) => <Harness {...args} />,
};

export const NoGate: Story = {
  args: {
    title: "Approve proposal?",
    description: "Your vote is recorded on chain and cannot be withdrawn.",
    confirmLabel: "Approve",
    confirmationMode: "none",
  },
  render: (args) => <Harness {...args} />,
};

export const BusySubmitting: Story = {
  args: {
    title: "Burn 1,000 BCC?",
    description: "Submitting the burn transaction.",
    confirmLabel: "Burn supply",
    busy: true,
    busyLabel: "Submitting…",
    confirmationMode: "none",
  },
  render: (args) => <Harness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("confirmation-dialog-confirm"),
    ).toBeDisabled();
    await expect(
      canvas.getByTestId("confirmation-dialog-confirm"),
    ).toHaveTextContent("Submitting…");
    await expect(
      canvas.getByTestId("confirmation-dialog-cancel"),
    ).toBeDisabled();

    // Escape must not dismiss a dialog with a transaction in flight.
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByTestId("confirmation-dialog")).toBeVisible();
  },
};

export const EscapeCloses: Story = {
  render: (args) => <Harness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByTestId("confirmation-dialog")).toBeNull();
    await expect(canvas.getByTestId("last-action")).toHaveTextContent(
      "Last action: cancelled",
    );
  },
};

export const FocusTrap: Story = {
  render: (args) => <Harness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Satisfy the gate first so Confirm is focusable.
    await userEvent.click(canvas.getByTestId("confirmation-dialog-checkbox"));

    const confirm = canvas.getByTestId("confirmation-dialog-confirm");
    confirm.focus();

    // Tab past the last control wraps back inside the dialog.
    await userEvent.tab();
    await expect(
      canvas.getByTestId("confirmation-dialog-checkbox"),
    ).toHaveFocus();

    await userEvent.tab({ shift: true });
    await expect(confirm).toHaveFocus();

    // Drop focus before the frame is recorded. The focus ring is the only part
    // of this story that renders differently at sub-pixel level between runs,
    // and the visual suite compares at zero tolerance, so leaving it drawn made
    // the baseline flap by around ten pixels.
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

export const Closed: Story = {
  args: { open: false },
  render: (args) => <Harness {...args} />,
};
