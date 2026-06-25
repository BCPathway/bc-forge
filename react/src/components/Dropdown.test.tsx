import '@testing-library/jest-dom';
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Dropdown } from './Dropdown';

const items = [
  { label: 'Option A', value: 'a' },
  { label: 'Option B', value: 'b' },
  { label: 'Option C', value: 'c' },
];

describe('Dropdown', () => {
  describe('rendering', () => {
    it('renders trigger with placeholder', () => {
      render(<Dropdown items={items} />);
      expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
      expect(screen.getByText('Select...')).toBeInTheDocument();
    });

    it('renders with a custom placeholder', () => {
      render(<Dropdown items={items} placeholder="Choose one" />);
      expect(screen.getByText('Choose one')).toBeInTheDocument();
    });

    it('shows the selected item label when defaultValue is provided', () => {
      render(<Dropdown items={items} defaultValue="b" />);
      expect(screen.getByText('Option B')).toBeInTheDocument();
    });

    it('shows the selected item label when value is provided (controlled)', () => {
      render(<Dropdown items={items} value="c" />);
      expect(screen.getByText('Option C')).toBeInTheDocument();
    });
  });

  describe('open / close behavior', () => {
    it('opens the menu on trigger click', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('closes the menu when clicking an item', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      fireEvent.click(screen.getByText('Option A'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes the menu when clicking outside', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      act(() => {
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes the menu on Escape', () => {
      render(<Dropdown items={items} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('toggles the menu on repeated clicks', () => {
      render(<Dropdown items={items} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('item selection', () => {
    it('calls onChange with the selected item', () => {
      const onChange = jest.fn();
      render(<Dropdown items={items} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      fireEvent.click(screen.getByText('Option B'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(items[1]);
    });

    it('updates the displayed label on selection (uncontrolled)', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      fireEvent.click(screen.getByText('Option C'));
      expect(screen.getByText('Option C')).toBeInTheDocument();
    });

    it('does not update the displayed label in controlled mode', () => {
      const { rerender } = render(<Dropdown items={items} value="a" />);
      const trigger = screen.getByRole('button', { name: /option a/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Option B'));
      expect(screen.getByText('Option A')).toBeInTheDocument();

      rerender(<Dropdown items={items} value="b" />);
      expect(screen.getByText('Option B')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('does not open the menu when disabled', () => {
      render(<Dropdown items={items} disabled />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('disables the trigger button', () => {
      render(<Dropdown items={items} disabled />);
      expect(screen.getByRole('button', { name: /select/i })).toBeDisabled();
    });

    it('disables individual menu items', () => {
      const disabledItems = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b', disabled: true },
        { label: 'C', value: 'c' },
      ];
      const onChange = jest.fn();
      render(<Dropdown items={disabledItems} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));

      const disabledBtn = screen.getByText('B').closest('button');
      expect(disabledBtn).toBeDisabled();

      fireEvent.click(disabledBtn!);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    it('opens the menu with ArrowDown', () => {
      render(<Dropdown items={items} />);
      fireEvent.keyDown(screen.getByRole('button', { name: /select/i }), { key: 'ArrowDown' });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('opens the menu with Enter', () => {
      render(<Dropdown items={items} />);
      fireEvent.keyDown(screen.getByRole('button', { name: /select/i }), { key: 'Enter' });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('opens the menu with Space', () => {
      render(<Dropdown items={items} />);
      fireEvent.keyDown(screen.getByRole('button', { name: /select/i }), { key: ' ' });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('navigates forward with ArrowDown and selects with Enter', () => {
      const onChange = jest.fn();
      render(<Dropdown items={items} onChange={onChange} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(items[1]);
    });

    it('navigates backward with ArrowUp', () => {
      const onChange = jest.fn();
      render(<Dropdown items={items} onChange={onChange} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowUp' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(items[items.length - 1]);
    });

    it('wraps forward from last item back to first', () => {
      const onChange = jest.fn();
      render(<Dropdown items={items} onChange={onChange} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(items[0]);
    });

    it('skips disabled items in keyboard navigation', () => {
      const disabledItems = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b', disabled: true },
        { label: 'C', value: 'c' },
      ];
      const onChange = jest.fn();
      render(<Dropdown items={disabledItems} onChange={onChange} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(disabledItems[2]);
    });

    it('supports Home and End keys', () => {
      const onChange = jest.fn();
      render(<Dropdown items={items} onChange={onChange} />);
      const trigger = screen.getByRole('button', { name: /select/i });

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'End' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(items[2]);

      fireEvent.keyDown(screen.getByRole('button', { name: /option c/i }), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('button', { name: /option c/i }), { key: 'Home' });
      fireEvent.keyDown(screen.getByRole('button', { name: /option c/i }), { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(items[0]);
    });
  });

  describe('ARIA attributes', () => {
    it('has aria-haspopup on trigger', () => {
      render(<Dropdown items={items} />);
      expect(screen.getByRole('button', { name: /select/i })).toHaveAttribute('aria-haspopup', 'menu');
    });

    it('toggles aria-expanded', () => {
      render(<Dropdown items={items} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('has aria-controls pointing to the menu id', () => {
      render(<Dropdown items={items} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.click(trigger);
      const menu = screen.getByRole('menu');
      expect(trigger).toHaveAttribute('aria-controls', menu.id);
    });

    it('has role="menu" on the menu', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('has role="menuitem" on each item', () => {
      render(<Dropdown items={items} />);
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(3);
    });

    it('updates aria-activedescendant on keyboard navigation', () => {
      render(<Dropdown items={items} />);
      const trigger = screen.getByRole('button', { name: /select/i });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      const menu = screen.getByRole('menu');
      expect(menu).toHaveAttribute('aria-activedescendant', `${menu.id}-item-0`);

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(menu).toHaveAttribute('aria-activedescendant', `${menu.id}-item-1`);
    });
  });

  describe('variant styles', () => {
    it('applies default variant by default', () => {
      const { container } = render(<Dropdown items={items} />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ backgroundColor: '#ffffff' });
    });

    it('applies primary variant styles', () => {
      const { container } = render(<Dropdown items={items} variant="primary" />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ backgroundColor: '#2563eb' });
    });

    it('applies danger variant styles', () => {
      const { container } = render(<Dropdown items={items} variant="danger" />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ backgroundColor: '#dc2626' });
    });
  });

  describe('size styles', () => {
    it('applies sm size styles', () => {
      const { container } = render(<Dropdown items={items} size="sm" />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ fontSize: '12px' });
    });

    it('applies md size styles by default', () => {
      const { container } = render(<Dropdown items={items} />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ fontSize: '14px' });
    });

    it('applies lg size styles', () => {
      const { container } = render(<Dropdown items={items} size="lg" />);
      const button = container.querySelector('button');
      expect(button).toHaveStyle({ fontSize: '16px' });
    });
  });

  describe('ref and custom props', () => {
    it('forwards ref to the wrapper div', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Dropdown ref={ref} items={items} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('forwards data attributes via ...rest', () => {
      render(<Dropdown items={items} data-testid="my-dropdown" />);
      expect(screen.getByTestId('my-dropdown')).toBeInTheDocument();
    });

    it('forwards className', () => {
      render(<Dropdown items={items} data-testid="dd" className="custom-class" />);
      expect(screen.getByTestId('dd')).toHaveClass('custom-class');
    });
  });
});
