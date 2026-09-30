// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from '../../../scripts/release-notes.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

describe('component release notes (#1035)', () => {
  it('returns only the React section and marks migration changes', () => {
    const notes = extractReleaseNotes('react', '1.0.0', rootDir);
    expect(notes).toContain('## [1.0.0]');
    expect(notes).toContain('### Breaking');
    expect(notes).toContain('### Features');
    expect(notes).toContain('### Fixes');
    expect(notes).toContain('### Migrations');
    expect(notes).toContain('@bc-forge/react');
    expect(notes).not.toContain('@bc-forge/indexer');
  });

  it('returns only the indexer section for the selected version', () => {
    const notes = extractReleaseNotes('indexer', '1.0.0', rootDir);
    expect(notes).toContain('@bc-forge/indexer');
    expect(notes).toContain('### Migrations');
    expect(notes).not.toContain('@bc-forge/react');
  });

  it('fails when the requested version has no section', () => {
    expect(() => extractReleaseNotes('react', '9.9.9', rootDir)).toThrow(/9\.9\.9/);
  });

  it('fails for an unknown component', () => {
    expect(() => extractReleaseNotes('sdk', '1.0.0', rootDir)).toThrow(/Unknown component/);
  });
});
