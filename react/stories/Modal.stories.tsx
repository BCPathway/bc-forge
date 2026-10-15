// SPDX-License-Identifier: MIT
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Modal, type ModalSize } from '../src/components/Modal';

const CONFIRM_STYLE = {
  padding: '6px 12px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const meta = {
  title: 'Primitives/Modal',
  component: Modal,
  args: {
    open: true,
    title: 'Confirm deposit',
    description: 'Deposits cannot be reversed once submitted.',
    closeOnBackdropClick: true,
    closeOnEscape: true,
  },
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Open on load, dismissible from the backdrop, Escape or the close button. */
export const WithDescription: Story = {
  render: ({ open: initialOpen, ...rest }) => {
    const [open, setOpen] = useState(initialOpen);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <Modal {...rest} open={open} onClose={() => setOpen(false)}>
          <p style={{ margin: 0, fontSize: 14 }}>
            The contract works in the smallest indivisible unit, so this dialog
            never rescales the amount for you.
          </p>
        </Modal>
      </>
    );
  },
};

/** A confirmation flow with actions under the body. */
export const WithFooter: Story = {
  render: ({ open: initialOpen, ...rest }) => {
    const [open, setOpen] = useState(initialOpen);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Review deposit
        </button>
        <Modal
          {...rest}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" style={CONFIRM_STYLE}>
                Confirm
              </button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 14 }}>1,000,000 base units</p>
        </Modal>
      </>
    );
  },
};

/** Opens the dialog at each of the three width presets. */
export const Sizes: Story = {
  render: ({ open: initialOpen, ...rest }) => {
    const [size, setSize] = useState<ModalSize | null>(initialOpen ? 'md' : null);
    return (
      <>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['sm', 'md', 'lg'] as const).map((option) => (
            <button key={option} type="button" onClick={() => setSize(option)}>
              {option}
            </button>
          ))}
        </div>
        <Modal
          {...rest}
          open={size !== null}
          onClose={() => setSize(null)}
          size={size ?? 'md'}
          title={`Width: ${size ?? 'md'}`}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            Reopen at another width to compare the presets.
          </p>
        </Modal>
      </>
    );
  },
};

/** Locked down to the close button: no Escape, no backdrop dismissal. */
export const NonDismissible: Story = {
  render: ({ open: initialOpen, ...rest }) => {
    const [open, setOpen] = useState(initialOpen);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Reconnect
        </button>
        <Modal
          {...rest}
          open={open}
          onClose={() => setOpen(false)}
          title="Session expired"
          description="Reconnect your wallet to continue."
          closeOnBackdropClick={false}
          closeOnEscape={false}
        >
          <button type="button" style={CONFIRM_STYLE} onClick={() => setOpen(false)}>
            Reconnect
          </button>
        </Modal>
      </>
    );
  },
};