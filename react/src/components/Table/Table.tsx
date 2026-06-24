import React from 'react';
import './Table.css';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /**
   * The visual style variant of the table.
   * @default 'default'
   */
  variant?: 'default' | 'striped' | 'bordered';
  /**
   * The size of the table cells.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className = '', variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <div className={`table-container table-size-${size}`}>
        <table
          ref={ref}
          className={`table table-variant-${variant} ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Table.displayName = 'Table';

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = '', ...props }, ref) => <thead ref={ref} className={`table-header ${className}`} {...props} />
);
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = '', ...props }, ref) => <tbody ref={ref} className={`table-body ${className}`} {...props} />
);
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className = '', ...props }, ref) => <tr ref={ref} className={`table-row ${className}`} {...props} />
);
TableRow.displayName = 'TableRow';

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className = '', ...props }, ref) => <td ref={ref} className={`table-cell ${className}`} {...props} />
);
TableCell.displayName = 'TableCell';

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className = '', ...props }, ref) => <th ref={ref} className={`table-head ${className}`} {...props} />
);
TableHead.displayName = 'TableHead';
