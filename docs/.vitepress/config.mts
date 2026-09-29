// VitePress configuration for the bc-forge docs site.
//
// The site root is this `docs/` directory, so every `docs/*.md` page is part
// of the site. Generated API references are added at build time:
//   - SDK reference: TypeDoc -> docs/api/sdk/ (typedoc-plugin-markdown)
//   - Contract reference: cargo doc -> docs/public/api/contracts/ (static rustdoc)
//
// This config exports a plain object (no `defineConfig` import) so the site can
// build with the toolchain installed at the repository root.

export default {
  title: 'bc-forge',
  description:
    'Documentation for the bc-forge Soroban token platform: contracts, TypeScript SDK, CLI, and security runbooks.',
  cleanUrls: false,
  // The contract reference is static rustdoc HTML generated at build time, so
  // links into it cannot be resolved by the Markdown dead-link checker.
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guides', link: '/ARCHITECTURE' },
      {
        text: 'API',
        items: [
          { text: 'SDK Reference', link: '/api/sdk' },
          { text: 'Contract Reference', link: '/api/contracts' },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Architecture', link: '/ARCHITECTURE' },
          { text: 'Access Control', link: '/ACCESS_CONTROL' },
          { text: 'Admin Keys', link: '/ADMIN_KEYS' },
          { text: 'Upgrade Guide', link: '/UPGRADE_GUIDE' },
          { text: 'Vaults', link: '/VAULTS' },
          { text: 'Walkthrough', link: '/WALKTHROUGH' },
          { text: 'Compatibility', link: '/COMPATIBILITY' },
          { text: 'Release Checklist', link: '/RELEASE_CHECKLIST' },
          { text: 'SDK Errors', link: '/sdk-errors' },
        ],
      },
      {
        text: 'Security & Audit',
        items: [
          { text: 'Audit Readiness', link: '/AUDIT_READINESS' },
          { text: 'Bug Bounty', link: '/BUG_BOUNTY' },
          { text: 'Traceability Matrix', link: '/TRACEABILITY' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'SDK Reference', link: '/api/sdk' },
          { text: 'Contract Reference', link: '/api/contracts' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/BCPathway/bc-forge' }],
  },
};
