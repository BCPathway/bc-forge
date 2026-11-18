// SPDX-License-Identifier: MIT
import React from "react";

const links = [
  { href: "#/", label: "Connect" },
  { href: "#/mint", label: "Mint" },
  { href: "#/transfer", label: "Transfer" },
  { href: "#/burn", label: "Burn" },
  { href: "#/roles", label: "Roles" },
  { href: "#/vaults", label: "Vaults" },
];

export const Nav: React.FC = () => {
  const [open, setOpen] = React.useState(true);

  return (
    <div>
      <button
        type="button"
        data-testid="mobile-menu-toggle"
        aria-label="menu"
        className="md:hidden rounded-glass mb-2 px-2 py-1 text-caption font-semibold"
        onClick={() => setOpen((prev) => !prev)}
      >
        Menu
      </button>
      {open ? (
        <nav
          aria-label="Demo screens"
          data-testid="demo-nav"
          className="mobile-drawer mt-4 flex flex-wrap gap-4"
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
      ) : null}
    </div>
  );
};
