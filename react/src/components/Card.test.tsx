import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello World</Card>);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders as a div by default', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content').tagName).toBe('DIV');
  });

  it('applies the bc-forge-card class', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toHaveClass('bc-forge-card');
  });

  it('merges custom className', () => {
    render(<Card className="my-card">Content</Card>);
    const card = screen.getByText('Content');
    expect(card).toHaveClass('bc-forge-card', 'my-card');
  });

  it('merges custom style', () => {
    render(<Card style={{ marginTop: '20px' }}>Content</Card>);
    expect(screen.getByText('Content').style.marginTop).toBe('20px');
  });

  it.each(['elevated', 'outlined', 'filled'] as const)(
    'renders %s variant with border-radius',
    (variant) => {
      render(<Card variant={variant}>Content</Card>);
      expect(screen.getByText('Content').style.borderRadius).toBe('8px');
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders %s size with padding', (size) => {
    render(<Card size={size}>Content</Card>);
    expect(screen.getByText('Content').style.padding).toBeTruthy();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref}>Content</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.textContent).toBe('Content');
  });

  it('passes through data attributes', () => {
    render(<Card data-testid="test-card">Content</Card>);
    expect(screen.getByTestId('test-card')).toBeInTheDocument();
  });

  it('passes through aria attributes', () => {
    render(<Card aria-label="Card label">Content</Card>);
    expect(screen.getByLabelText('Card label')).toBeInTheDocument();
  });

  it('renders the id attribute', () => {
    render(<Card id="my-card">Content</Card>);
    expect(screen.getByText('Content')).toHaveAttribute('id', 'my-card');
  });

  describe('asChild polymorphic behavior', () => {
    it('renders as the child element type', () => {
      render(
        <Card asChild>
          <article>Content</article>
        </Card>,
      );
      const card = screen.getByText('Content');
      expect(card.tagName).toBe('ARTICLE');
      expect(card).toHaveClass('bc-forge-card');
    });

    it('merges parent and child classNames', () => {
      render(
        <Card asChild className="parent-class">
          <section className="child-class">Content</section>
        </Card>,
      );
      expect(screen.getByText('Content')).toHaveClass(
        'bc-forge-card',
        'parent-class',
        'child-class',
      );
    });

    it('merges parent and child styles (child wins on conflict)', () => {
      render(
        <Card asChild style={{ margin: '10px', padding: '10px' }}>
          <section style={{ padding: '5px' }}>Content</section>
        </Card>,
      );
      const card = screen.getByText('Content');
      expect(card.style.margin).toBe('10px');
      expect(card.style.padding).toBe('5px');
    });
  });

  describe('interactive (onClick provided)', () => {
    it('calls onClick when clicked', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Content</Card>);
      fireEvent.click(screen.getByText('Content'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Enter keydown', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Content</Card>);
      fireEvent.keyDown(screen.getByText('Content'), { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space keydown', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Content</Card>);
      fireEvent.keyDown(screen.getByText('Content'), { key: ' ' });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on other keys', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Content</Card>);
      fireEvent.keyDown(screen.getByText('Content'), { key: 'Escape' });
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('calls onKeyDown in addition to onClick', () => {
      const handleClick = vi.fn();
      const handleKeyDown = vi.fn();
      render(
        <Card onClick={handleClick} onKeyDown={handleKeyDown}>
          Content
        </Card>,
      );
      fireEvent.keyDown(screen.getByText('Content'), { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);
      expect(handleKeyDown).toHaveBeenCalledTimes(1);
    });

    it('sets role="button" by default', () => {
      render(<Card onClick={() => {}}>Content</Card>);
      expect(screen.getByText('Content')).toHaveAttribute('role', 'button');
    });

    it('sets tabIndex={0} by default', () => {
      render(<Card onClick={() => {}}>Content</Card>);
      expect(screen.getByText('Content')).toHaveAttribute('tabindex', '0');
    });

    it('respects a custom role override', () => {
      render(
        <Card onClick={() => {}} role="link">
          Content
        </Card>,
      );
      expect(screen.getByText('Content')).toHaveAttribute('role', 'link');
    });

    it('respects a custom tabIndex override', () => {
      render(
        <Card onClick={() => {}} tabIndex={3}>
          Content
        </Card>,
      );
      expect(screen.getByText('Content')).toHaveAttribute('tabindex', '3');
    });
  });

  describe('non-interactive (no onClick)', () => {
    it('does not set role', () => {
      render(<Card>Content</Card>);
      expect(screen.getByText('Content')).not.toHaveAttribute('role');
    });

    it('does not set tabIndex', () => {
      render(<Card>Content</Card>);
      expect(screen.getByText('Content')).not.toHaveAttribute('tabindex');
    });
  });
});
