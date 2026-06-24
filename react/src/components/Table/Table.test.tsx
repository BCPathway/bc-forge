import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './Table';

describe('Table Component', () => {
  it('renders without crashing', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('applies variant and size classes correctly', () => {
    const { container } = render(
      <Table variant="striped" size="lg">
        <TableBody>
          <TableRow>
            <TableCell>Content</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    
    expect(container.firstChild).toHaveClass('table-size-lg');
    const tableEl = container.querySelector('table');
    expect(tableEl).toHaveClass('table-variant-striped');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>John</TableCell>
            <TableCell>30</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
