import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['elevated', 'outlined', 'filled'],
      description: 'Visual style of the card',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size preset controlling padding',
    },
    asChild: {
      control: 'boolean',
      description: 'Merge props onto child element instead of wrapping',
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    size: 'md',
    children: 'This is an elevated card with a subtle shadow.',
  },
};

export const Outlined: Story = {
  args: {
    variant: 'outlined',
    size: 'md',
    children: 'This is an outlined card with a border.',
  },
};

export const Filled: Story = {
  args: {
    variant: 'filled',
    size: 'md',
    children: 'This is a filled card with a light background.',
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small card — 16px padding.',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large card — 32px padding.',
  },
};

export const Interactive: Story = {
  args: {
    onClick: () => alert('Card clicked'),
    children: 'Click me — I support keyboard Enter/Space too.',
  },
};

export const AsSection: Story = {
  args: {
    asChild: true,
    children: <section>This card renders as a &lt;section&gt; element.</section>,
  },
};
