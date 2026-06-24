import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Tabs } from './Tabs';

const renderTabs = (props: Record<string, unknown> = {}) =>
  render(
    <Tabs defaultValue="a" {...props}>
      <Tabs.List>
        <Tabs.Tab value="a">Tab A</Tabs.Tab>
        <Tabs.Tab value="b">Tab B</Tabs.Tab>
        <Tabs.Tab value="c">Tab C</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="a">Panel A</Tabs.Panel>
      <Tabs.Panel value="b">Panel B</Tabs.Panel>
      <Tabs.Panel value="c">Panel C</Tabs.Panel>
    </Tabs>,
  );

describe('Tabs', () => {
  it('renders tabs and the active panel', () => {
    renderTabs();
    expect(screen.getByText('Tab A')).toBeInTheDocument();
    expect(screen.getByText('Tab B')).toBeInTheDocument();
    expect(screen.getByText('Tab C')).toBeInTheDocument();
    expect(screen.getByText('Panel A')).toBeInTheDocument();
  });

  it('shows only the active panel', () => {
    renderTabs();
    // Only Panel A is visible initially (defaultValue = "a")
    expect(screen.getByText('Panel A')).toBeVisible();
    expect(screen.queryByText('Panel B')).not.toBeVisible();
    expect(screen.queryByText('Panel C')).not.toBeVisible();
  });

  it('switches panel on tab click', () => {
    renderTabs();
    fireEvent.click(screen.getByText('Tab B'));
    expect(screen.queryByText('Panel A')).not.toBeVisible();
    expect(screen.getByText('Panel B')).toBeVisible();
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = jest.fn();
    renderTabs({ onChange });
    fireEvent.click(screen.getByText('Tab B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('works in controlled mode', () => {
    const { rerender } = render(
      <Tabs value="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">A Panel</Tabs.Panel>
        <Tabs.Panel value="b">B Panel</Tabs.Panel>
      </Tabs>,
    );
    expect(screen.getByText('A Panel')).toBeVisible();

    rerender(
      <Tabs value="b">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">A Panel</Tabs.Panel>
        <Tabs.Panel value="b">B Panel</Tabs.Panel>
      </Tabs>,
    );
    expect(screen.getByText('B Panel')).toBeVisible();
  });

  it('renders with role="tablist" on the list', () => {
    renderTabs();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders tabs with role="tab"', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('marks only the active tab as aria-selected', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('links tabs and panels via aria-controls / aria-labelledby', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    const panel = screen.getByRole('tabpanel');

    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
  });

  it('has tabIndex -1 on inactive tabs and 0 on the active tab', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  describe('keyboard navigation', () => {
    it('ArrowRight activates the next tab', () => {
      renderTabs();
      const [tabA, tabB] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabA, { key: 'ArrowRight' });
      expect(tabB).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowLeft activates the previous tab', () => {
      renderTabs({ defaultValue: 'b' });
      const [tabA, tabB] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabB, { key: 'ArrowLeft' });
      expect(tabA).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowRight wraps to the first tab from the last', () => {
      renderTabs({ defaultValue: 'c' });
      const [tabA, , tabC] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabC, { key: 'ArrowRight' });
      expect(tabA).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowLeft wraps to the last tab from the first', () => {
      renderTabs();
      const [tabA, , tabC] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabA, { key: 'ArrowLeft' });
      expect(tabC).toHaveAttribute('aria-selected', 'true');
    });

    it('Home activates the first tab', () => {
      renderTabs({ defaultValue: 'c' });
      const [tabA, , tabC] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabC, { key: 'Home' });
      expect(tabA).toHaveAttribute('aria-selected', 'true');
    });

    it('End activates the last tab', () => {
      renderTabs();
      const [tabA, , tabC] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabA, { key: 'End' });
      expect(tabC).toHaveAttribute('aria-selected', 'true');
    });

    it('does not swallow other key presses', () => {
      renderTabs();
      const [tabA] = screen.getAllByRole('tab');
      fireEvent.keyDown(tabA, { key: 'Enter' });
      // Enter on a button triggers click, so no error
      expect(tabA).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('renders different variants without error', () => {
    const variants: Array<'underline' | 'pills' | 'tabs'> = ['underline', 'pills', 'tabs'];
    for (const variant of variants) {
      const { unmount } = render(
        <Tabs defaultValue="a" variant={variant}>
          <Tabs.List>
            <Tabs.Tab value="a">A</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="a">Content</Tabs.Panel>
        </Tabs>,
      );
      expect(screen.getByText('A')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders different sizes without error', () => {
    const sizes: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg'];
    for (const size of sizes) {
      const { unmount } = render(
        <Tabs defaultValue="a" size={size}>
          <Tabs.List>
            <Tabs.Tab value="a">A</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="a">Content</Tabs.Panel>
        </Tabs>,
      );
      expect(screen.getByText('A')).toBeInTheDocument();
      unmount();
    }
  });

  it('forwards a ref to the root element', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Tabs ref={ref} defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">Content</Tabs.Panel>
      </Tabs>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('passes data attributes and class names through', () => {
    render(
      <Tabs data-testid="root" className="root-class" defaultValue="a">
        <Tabs.List data-testid="list" className="list-class">
          <Tabs.Tab data-testid="tab" className="tab-class" value="a">
            Tab
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel data-testid="panel" className="panel-class" value="a">
          Panel
        </Tabs.Panel>
      </Tabs>,
    );
    expect(screen.getByTestId('root')).toHaveClass('root-class');
    expect(screen.getByTestId('list')).toHaveClass('list-class');
    expect(screen.getByTestId('tab')).toHaveClass('tab-class');
    expect(screen.getByTestId('panel')).toHaveClass('panel-class');
  });

  it('throws if subcomponents are rendered outside of Tabs', () => {
    // Suppress console.error from the expected React error boundary
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Tabs.List />)).toThrow(
      'Tabs compound components must be used within <Tabs>.',
    );
    spy.mockRestore();
  });
});
