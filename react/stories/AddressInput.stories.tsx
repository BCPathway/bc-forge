// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddressInput } from "../src/components/AddressInput";

const meta = {
  title: "Primitives/AddressInput",
  component: AddressInput,
  args: { placeholder: "G... or C..." },
} satisfies Meta<typeof AddressInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Invalid: Story = {
  args: { defaultValue: "not-a-stellar-address" },
};
