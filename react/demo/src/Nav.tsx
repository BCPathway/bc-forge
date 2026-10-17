// SPDX-License-Identifier: MIT
import React from 'react';

const links = [
  { href: '#/', label: 'Connect' },
  { href: '#/mint', label: 'Mint' },
  { href: '#/transfer', label: 'Transfer' },
  { href: '#/burn', label: 'Burn' },
  { href: '#/roles', label: 'Roles' },
  { href: '#/vaults', label: 'Vaults' },
];

export const Nav: React.FC = () => (
  <nav
    aria-label="Demo screens"
    data-testid="demo-nav"
    className="mt-4 flex flex-wrap gap-4"
  >
    {links.map(({ href, label }) => (
      <a
        key={href}
        href={href}
        data-testid={`nav-${label.toLowerCase()}`}
        className="rounded-glass px-2 py-1 font-medium text-[var(--bc-brand-primary)] underline underline-offset-4 hover:text-[var(--bc-brand-primary-hover)]"
      >
        {label}
      </a>
    ))}
  </nav>
);