// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  validateVersionTag,
  validateBeforeChangesetPublish,
  classifyRegistryRelease,
  parseReleaseTag,
  KNOWN_PACKAGES,
} from '../../../scripts/check-version-tag.mjs';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, '../../../../');
const scriptPath = path.resolve(rootDir, 'scripts/check-version-tag.mjs');

describe('scripts/check-version-tag.mjs', () => {
  const mockUnpublishedRegistry = () => false;
  const mockPublishedRegistry = () => true;

  describe('validateVersionTag logic', () => {
    it('passes for a valid tag matching the manifest version', () => {
      const result = validateVersionTag('sdk@0.1.0', {
        rootDir,
        checkRegistry: mockUnpublishedRegistry,
      });
      expect(result.success).toBe(true);
      expect(result.component).toBe('sdk');
      expect(result.version).toBe('0.1.0');
    });

    it('handles ref/tags/ prefix in GITHUB_REF tag format', () => {
      const result = validateVersionTag('refs/tags/cli@0.1.0', {
        rootDir,
        checkRegistry: mockUnpublishedRegistry,
      });
      expect(result.success).toBe(true);
      expect(result.component).toBe('cli');
      expect(result.version).toBe('0.1.0');
    });

    it('passes for react package version', () => {
      const result = validateVersionTag('react@1.0.0', {
        rootDir,
        checkRegistry: mockUnpublishedRegistry,
      });
      expect(result.success).toBe(true);
      expect(result.component).toBe('react');
      expect(result.version).toBe('1.0.0');
    });

    it('keeps the prerelease suffix on a React tag', () => {
      const parsed = parseReleaseTag('refs/tags/react-v1.0.0-beta.1');
      expect(parsed.component).toBe('react');
      expect(parsed.version).toBe('1.0.0-beta.1');

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-tag-'));
      fs.mkdirSync(path.join(dir, 'react'));
      fs.writeFileSync(
        path.join(dir, 'react', 'package.json'),
        JSON.stringify({ name: '@bc-forge/react', version: '1.0.0-beta.1' }),
      );
      const result = validateVersionTag('react-v1.0.0-beta.1', {
        rootDir: dir,
        checkRegistry: mockUnpublishedRegistry,
      });
      expect(result.version).toBe('1.0.0-beta.1');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fails a React tag for the wrong component or a mismatched version', () => {
      expect(() => {
        validateVersionTag('widget@1.0.0', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Unknown component "widget"/);

      expect(() => {
        validateVersionTag('react@9.9.9', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Tag version "9\.9\.9" does not match package\.json version/);

      expect(() => {
        validateVersionTag('react-v1.0.0-beta.1', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Tag version "1\.0\.0-beta\.1" does not match package\.json version/);
    });

    it('fails when tag has wrong version', () => {
      expect(() => {
        validateVersionTag('sdk@9.9.9', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Tag version "9\.9\.9" does not match package\.json version/);
    });

    it('fails when tag format is malformed (no @)', () => {
      expect(() => {
        validateVersionTag('invalidtag', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Malformed tag format/);
    });

    it('fails when tag format has empty component or version', () => {
      expect(() => {
        validateVersionTag('@0.1.0', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Malformed tag format/);

      expect(() => {
        validateVersionTag('sdk@', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Malformed tag format/);

      expect(() => {
        validateVersionTag('sdk@1.0.0@2.0.0', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Malformed tag format/);
    });

    it('fails when component name is unknown', () => {
      expect(() => {
        validateVersionTag('unknown-pkg@1.0.0', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Unknown component "unknown-pkg"/);
    });

    it('passes component-v and Changesets tag forms when the version matches', () => {
      for (const tag of ['sdk-v0.1.0', '@bc-forge/sdk@0.1.0', 'refs/tags/cli-v0.1.0']) {
        const result = validateVersionTag(tag, {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects a non-semver version as malformed', () => {
      expect(() => {
        validateVersionTag('sdk@not-a-version', {
          rootDir,
          checkRegistry: mockUnpublishedRegistry,
        });
      }).toThrow(/Malformed tag format/);
    });

    it('validates unpublished packages and treats a matching republish as a no-op', () => {
      const unpublished = validateBeforeChangesetPublish({
        rootDir,
        inspectRegistry: () => ({ published: false, remoteVersion: null, hasArtifact: false }),
      });
      expect(unpublished.map((result) => result.component).sort()).toEqual(
        Object.keys(KNOWN_PACKAGES).sort(),
      );
      expect(unpublished.every((result) => !result.noop)).toBe(true);

      const rerun = validateBeforeChangesetPublish({
        rootDir,
        inspectRegistry: ({ version }) => ({
          published: true,
          remoteVersion: version,
          hasArtifact: true,
        }),
      });
      expect(rerun.map((result) => result.component).sort()).toEqual(
        Object.keys(KNOWN_PACKAGES).sort(),
      );
      expect(rerun.every((result) => result.noop)).toBe(true);
    });

    it('fails before Changesets publish when an existing artifact does not match', () => {
      expect(() => {
        validateBeforeChangesetPublish({
          rootDir,
          inspectRegistry: () => ({
            published: true,
            remoteVersion: '9.9.9',
            hasArtifact: true,
          }),
        });
      }).toThrow(/does not match the existing npm artifact/);

      expect(() => {
        validateBeforeChangesetPublish({
          rootDir,
          inspectRegistry: ({ version }) => ({
            published: true,
            remoteVersion: version,
            hasArtifact: true,
            artifactMatches: false,
          }),
        });
      }).toThrow(/does not match the existing npm artifact/);
    });

    it('classifies a matching published version as a no-op and a mismatch as failure', () => {
      expect(
        classifyRegistryRelease({
          published: false,
          remoteVersion: null,
          intendedVersion: '1.2.3',
          hasArtifact: false,
        }),
      ).toBe('publish');
      expect(
        classifyRegistryRelease({
          published: true,
          remoteVersion: '1.2.3',
          intendedVersion: '1.2.3',
          hasArtifact: true,
        }),
      ).toBe('noop');
      expect(
        classifyRegistryRelease({
          published: true,
          remoteVersion: '1.2.2',
          intendedVersion: '1.2.3',
          hasArtifact: true,
        }),
      ).toBe('mismatch');
      expect(
        classifyRegistryRelease({
          published: true,
          remoteVersion: '1.2.3',
          intendedVersion: '1.2.3',
          hasArtifact: false,
        }),
      ).toBe('mismatch');
      expect(
        classifyRegistryRelease({
          published: true,
          remoteVersion: '1.2.3',
          intendedVersion: '1.2.3',
          hasArtifact: true,
          artifactMatches: false,
        }),
      ).toBe('mismatch');
    });

    it('fails when version is already published (mocked registry check)', () => {
      expect(() => {
        validateVersionTag('sdk@0.1.0', {
          rootDir,
          checkRegistry: mockPublishedRegistry,
        });
      }).toThrow(/already published on the registry/);
    });
  });

  describe('CLI execution exit codes', () => {
    it('exits 0 on valid tag', () => {
      const output = execSync(`node "${scriptPath}" sdk@0.1.0`, {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(output).toContain('Tag "sdk@0.1.0" is valid');
    }, 20000);

    it('exits non-zero on tag with wrong version', () => {
      expect(() => {
        execSync(`node "${scriptPath}" sdk@99.9.9`, {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 15000,
        });
      }).toThrow();
    }, 20000);

    it('exits non-zero on malformed tag', () => {
      expect(() => {
        execSync(`node "${scriptPath}" malformedtag`, {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      }).toThrow();
    });

    it('exits non-zero on unknown component name', () => {
      expect(() => {
        execSync(`node "${scriptPath}" nonexistent@1.0.0`, {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      }).toThrow();
    });
  });
});
