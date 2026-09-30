// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const index = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../storybook-static/index.json'),
    'utf8',
  ),
) as {
  entries: Record<string, { id: string; type: string }>;
};
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === 'story',
);
if (stories.length === 0)
  throw new Error('The Storybook build contains no stories');

for (const { id } of stories) {
  test(id, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:6006')
        return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);
    await expect(page.locator('#storybook-root')).toHaveAttribute(
      'data-story-ready',
      id,
    );
    await page.evaluate(() => document.fonts.ready);
    expect(errors).toEqual([]);
    await expect(page.getByTestId('story-frame')).toHaveScreenshot(`${id}.png`);
    expect(errors).toEqual([]);
  });
}
