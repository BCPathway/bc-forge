// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { EmptyState, type EmptyStateProps } from './EmptyState';
import { theme } from '../theme';

const renderEmptyState = (props: EmptyStateProps) => render(<EmptyState {...props} />);

describe('EmptyState', () => {
  it('renders the title and description', () => {
    renderEmptyState({
      title: 'No transactions yet',
      description: 'Once you mint or transfer, activity shows up here.',
    });

    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('No transactions yet');
    expect(screen.getByTestId('empty-state-description')).toHaveTextContent(
      'Once you mint or transfer, activity shows up here.',
    );
  });

  it('renders cleanly with only a title', () => {
    renderEmptyState({ title: 'Nothing to show' });

    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('Nothing to show');
    expect(screen.queryByTestId('empty-state-description')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state-actions')).not.toBeInTheDocument();
  });

  it('renders a built-in decorative illustration by default', () => {
    renderEmptyState({ title: 'No results' });

    const icon = screen.getByTestId('empty-state-default-icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
  });

  it('renders custom iconography when one is supplied', () => {
    renderEmptyState({
      title: 'No results',
      icon: <span data-testid="custom-icon">🔍</span>,
    });

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state-default-icon')).not.toBeInTheDocument();
  });

  it('hides the illustration entirely for icon={null}', () => {
    renderEmptyState({ title: 'No results', icon: null });

    expect(screen.queryByTestId('empty-state-default-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state-icon-wrap')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-state-title')).toBeInTheDocument();
  });

  it('renders the primary action and calls its handler', () => {
    const onClick = jest.fn();
    renderEmptyState({
      title: 'No tokens',
      description: 'Mint your first token to get started.',
      action: { label: 'Mint a token', onClick },
    });

    const action = screen.getByTestId('empty-state-action');
    expect(action).toHaveAccessibleName('Mint a token');
    expect(action).toHaveStyle({ backgroundColor: theme.primary });
    expect(action).not.toBeDisabled();

    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled action without calling the handler', () => {
    const onClick = jest.fn();
    renderEmptyState({
      title: 'No tokens',
      action: { label: 'Mint a token', onClick, disabled: true },
    });

    const action = screen.getByTestId('empty-state-action');
    expect(action).toBeDisabled();
    expect(action).toHaveStyle({ cursor: 'not-allowed' });

    fireEvent.click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepts an action without a handler', () => {
    renderEmptyState({ title: 'No tokens', action: { label: 'Mint a token' } });

    expect(screen.getByTestId('empty-state-action')).toBeEnabled();
  });

  it('renders the secondary action alongside the primary one', () => {
    const onSecondary = jest.fn();
    renderEmptyState({
      title: 'No search results',
      action: { label: 'Clear filters', onClick: jest.fn() },
      secondaryAction: { label: 'Search again', onClick: onSecondary },
    });

    const primary = screen.getByTestId('empty-state-action');
    const secondary = screen.getByTestId('empty-state-secondary-action');

    expect(primary).toHaveStyle({ backgroundColor: theme.primary });
    expect(secondary).toHaveStyle({ backgroundColor: theme.surface, color: theme.text });

    fireEvent.click(secondary);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('empty-state-actions')).toContainElement(secondary);
  });

  it('renders a secondary action on its own', () => {
    renderEmptyState({ title: 'Nothing here', secondaryAction: { label: 'Reload' } });

    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-state-secondary-action')).toBeInTheDocument();
  });

  it('renders a pre-built node as the action', () => {
    renderEmptyState({
      title: 'No filters',
      action: <a href="/docs" data-testid="custom-action">Read the docs</a>,
    });

    expect(screen.getByTestId('custom-action')).toHaveAttribute('href', '/docs');
    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
  });

  it('renders a pre-built node as the secondary action', () => {
    renderEmptyState({
      title: 'No filters',
      secondaryAction: <button type="button" data-testid="custom-secondary">Dismiss</button>,
    });

    expect(screen.getByTestId('custom-secondary')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state-secondary-action')).not.toBeInTheDocument();
  });

  it('centres its content and pads generously', () => {
    renderEmptyState({ title: 'No results' });

    const root = screen.getByTestId('empty-state');
    expect(root).toHaveStyle({ textAlign: 'center', alignItems: 'center' });
    expect(root).toHaveStyle({ padding: '40px 24px' });
  });

  it('honours the size preset', () => {
    const { rerender } = render(<EmptyState title="No results" size="sm" />);
    expect(screen.getByTestId('empty-state')).toHaveStyle({ padding: '24px 16px' });

    rerender(<EmptyState title="No results" size="lg" />);
    expect(screen.getByTestId('empty-state')).toHaveStyle({ padding: '64px 32px' });
  });

  it('shows a focus ring on the action that has focus', () => {
    renderEmptyState({ title: 'No results', action: { label: 'Mint a token' } });

    const action = screen.getByTestId('empty-state-action');
    // React 17+ delegates onFocus/onBlur through focusin/focusout.
    fireEvent.focusIn(action);
    expect(action.getAttribute('style')).toContain(theme.primaryFocusRing);

    fireEvent.focusOut(action);
    expect(action.getAttribute('style')).not.toContain(theme.primaryFocusRing);
  });

  it('forwards standard div props and a ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <EmptyState
        ref={ref}
        title="No results"
        role="status"
        className="custom"
        style={{ backgroundColor: 'rgb(7, 8, 9)' }}
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    const root = screen.getByTestId('empty-state');
    expect(root).toHaveClass('custom');
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveStyle({ backgroundColor: 'rgb(7, 8, 9)' });
  });
});