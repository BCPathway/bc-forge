import React from 'react';
import { Meta, StoryFn } from '@storybook/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './Table';

export default {
  title: 'Components/Table',
  component: Table,
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'striped', 'bordered'],
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
    },
  },
} as Meta<typeof Table>;

const Template: StoryFn<typeof Table> = (args) => (
  <Table {...args}>
    <TableHeader>
      <TableRow>
        <TableHead>Column 1</TableHead>
        <TableHead>Column 2</TableHead>
        <TableHead>Column 3</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Row 1, Cell 1</TableCell>
        <TableCell>Row 1, Cell 2</TableCell>
        <TableCell>Row 1, Cell 3</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Row 2, Cell 1</TableCell>
        <TableCell>Row 2, Cell 2</TableCell>
        <TableCell>Row 2, Cell 3</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Row 3, Cell 1</TableCell>
        <TableCell>Row 3, Cell 2</TableCell>
        <TableCell>Row 3, Cell 3</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

export const Default = Template.bind({});
Default.args = {
  variant: 'default',
  size: 'md',
};

export const Striped = Template.bind({});
Striped.args = {
  variant: 'striped',
  size: 'md',
};

export const Bordered = Template.bind({});
Bordered.args = {
  variant: 'bordered',
  size: 'md',
};

export const Small = Template.bind({});
Small.args = {
  variant: 'default',
  size: 'sm',
};

export const Large = Template.bind({});
Large.args = {
  variant: 'default',
  size: 'lg',
};
