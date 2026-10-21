import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated Accessibility Audit Test Suite (#1261)
 * Integrates @axe-core/playwright to assert WCAG 2.1 AA compliance across all dApp screens.
 */
test.describe('bc-forge Accessibility Audits (WCAG 2.1 AA) (#1261)', () => {
  const routesToAudit = [
    { name: 'Dashboard / Home', path: '/' },
    { name: 'Vaults Screen', path: '/vaults' },
    { name: 'Roles Management', path: '/roles' },
    { name: 'Settings Screen', path: '/settings' },
  ];

  for (const route of routesToAudit) {
    test(`should pass automated accessibility audit with zero critical or serious violations on ${route.name}`, async ({ page }) => {
      await page.goto(route.path);

      // Ensure page content has loaded
      await page.waitForLoadState('domcontentloaded');

      // Run axe accessibility analysis
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Filter out minor/moderate if necessary, or assert zero critical/serious violations
      const seriousOrCriticalViolations = accessibilityScanResults.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical'
      );

      if (seriousOrCriticalViolations.length > 0) {
        console.error(
          `Accessibility violations found on ${route.path}:`,
          JSON.stringify(seriousOrCriticalViolations, null, 2)
        );
      }

      expect(seriousOrCriticalViolations).toEqual([]);
    });
  }
});