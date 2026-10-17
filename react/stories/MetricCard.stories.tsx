// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MetricCard, MetricStatBox } from "../src/components/MetricCard";

const meta = {
  title: "Primitives/MetricCard",
  component: MetricCard,
  args: {
    title: "Total supply",
    value: "1,250,000 BCC",
    subtitle: "Updated 2 minutes ago",
  },
} satisfies Meta<typeof MetricCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const BIG_SUPPLY = 123456789012345678901234n;

export const Default: Story = {};

export const Trends: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }}
    >
      <MetricCard
        {...args}
        title="Volume (24h)"
        value="$482,310"
        delta={12.4}
        deltaLabel="vs yesterday"
      />
      <MetricCard
        {...args}
        title="Volume (24h)"
        value="$391,004"
        delta={-8.9}
        deltaLabel="vs yesterday"
      />
      <MetricCard
        {...args}
        title="Volume (24h)"
        value="$428,000"
        delta={0}
        deltaLabel="vs yesterday"
      />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }}
    >
      {(["sm", "md", "lg"] as const).map((size) => (
        <MetricCard
          {...args}
          key={size}
          size={size}
          title={`Total supply (${size})`}
          value="1,250,000 BCC"
          delta={4.2}
          deltaLabel="vs last week"
        />
      ))}
    </div>
  ),
};

export const Loading: Story = {
  args: { title: "Total supply", value: "1,250,000 BCC", loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("metric-card")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(canvas.getByTestId("metric-card-skeleton")).toBeVisible();
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Total supply: Loading…",
    );
  },
};

export const BigintValue: Story = {
  args: {
    title: "Raw stroop balance",
    value: BIG_SUPPLY,
    subtitle: "Rendered from a bigint without precision loss",
  },
};

export const MissingValue: Story = {
  args: { title: "Holders", value: null },
};

export const NonFiniteValue: Story = {
  args: { title: "Share price", value: Number.NaN },
};

export const StatBox: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "stretch",
        flexWrap: "wrap",
      }}
    >
      {(["sm", "md", "lg"] as const).map((size) => (
        <MetricStatBox
          key={size}
          size={size}
          label="Holders"
          value={1284}
          delta={3.1}
          deltaLabel="this week"
        />
      ))}
    </div>
  ),
};
