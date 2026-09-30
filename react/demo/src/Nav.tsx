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
  <nav aria-label="Demo screens" data-testid="demo-nav">
    {links.map(({ href, label }) => (
      <a
        key={href}
        href={href}
        style={{ marginRight: 16 }}
        data-testid={`nav-${label.toLowerCase()}`}
      >
        {label}
      </a>
    ))}
  </nav>
);
