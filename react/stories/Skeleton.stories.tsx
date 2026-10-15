// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  SkeletonCard,
  SkeletonCircle,
  SkeletonText,
} from "../src/components/Skeleton";

const meta = {
  title: "Primitives/Skeleton",
  component: SkeletonCard,
} satisfies Meta<typeof SkeletonCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};

export const TextAndCircle: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16, width: 320 }}>
      <SkeletonCircle size={48} />
      <SkeletonText lines={3} />
    </div>
  ),
};
