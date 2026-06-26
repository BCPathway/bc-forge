import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('is hidden until hovered, then shows with role=tooltip and links the trigger', () => {
    const { container } = render(
      <Tooltip content="Help text">
        <button>trigger</button>
      </Tooltip>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Help text');
    expect(screen.getByRole('button', { name: 'trigger' })).toHaveAttribute(
      'aria-describedby',
      tip.id,
    );

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    const { container } = render(
      <Tooltip content="Help text">
        <button>trigger</button>
      </Tooltip>,
    );
    const wrapper = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(wrapper, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
