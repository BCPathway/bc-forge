/**
 * Regression test for the SDK build script not cleaning `dist` (#349).
 *
 * `npm run build` used to be a bare `tsc`. TypeScript emits outputs for the
 * source files it sees *now*; it never removes outputs whose source has gone.
 * Deleting or renaming a file under `src/` therefore left its compiled `.js`
 * and `.d.ts` behind in `dist/`, and those stale artifacts were published with
 * the package — importable by consumers although the source no longer existed.
 *
 * These tests drive a real `tsc` run over a throwaway project built inside the
 * SDK directory, so the assertion is about observed compiler behaviour rather
 * than a restatement of the `package.json` string. A test that only matched the
 * script text would still pass if the fix were reverted and the script renamed.
 *
 * Offline, no network, no dependency on the SDK's own sources.
 */

import { jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The suite is compiled to CommonJS by the package tsconfig, so import.meta is
// unavailable. The package scripts run from the SDK directory, which is where
// `npm test` and the CI job both start.
const SDK_ROOT = process.cwd();
const TSC = resolve(SDK_ROOT, '..', 'node_modules', '.bin', 'tsc');

/** Fail loudly if the suite is launched from somewhere other than the SDK. */
function assertSdkRoot(): void {
  const pkg = JSON.parse(readFileSync(join(SDK_ROOT, 'package.json'), 'utf8'));
  if (pkg.name !== '@bc-forge/sdk') {
    throw new Error(`run this suite with cwd at the SDK package, got ${SDK_ROOT}`);
  }
}

/** The `scripts` block exactly as it exists on disk right now. */
function sdkScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(SDK_ROOT, 'package.json'), 'utf8'));
  return pkg.scripts ?? {};
}

type Probe = { root: string; srcDir: string; outDir: string };

/**
 * Create a minimal two-file TypeScript project under the SDK directory.
 * Living under SDK_ROOT means `tsc` resolves normally; the directory is
 * outside `src/`, so the real build and Jest's testMatch both ignore it.
 */
function makeProbeProject(): Probe {
  const root = mkdtempSync(join(SDK_ROOT, '.tmp-build-regression-'));
  const srcDir = join(root, 'src');
  const outDir = join(root, 'dist');
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(join(srcDir, 'kept.ts'), 'export const kept = "kept";\n');
  writeFileSync(join(srcDir, 'doomed.ts'), 'export const doomed = "doomed";\n');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          declaration: true,
          strict: true,
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      },
      null,
      2,
    ),
  );
  return { root, srcDir, outDir };
}

/** Compile the probe project. Throws if tsc reports an error. */
function compile(root: string): void {
  execFileSync(process.execPath, [TSC, '--project', join(root, 'tsconfig.json')], {
    cwd: root,
    stdio: 'pipe',
  });
}

describe('SDK build script cleans dist (#349)', () => {
  beforeAll(() => {
    assertSdkRoot();
  });

  it('build no longer compiles without cleaning first', () => {
    const scripts = sdkScripts();
    expect(scripts.clean).toBeDefined();
    expect(scripts.build).toContain('clean');
    // a bare tsc is the exact shape of the bug
    expect(scripts.build.trim()).not.toBe('tsc');
  });

  it('bare tsc leaves behind artifacts whose source was deleted (the bug)', () => {
    const { root, srcDir, outDir } = makeProbeProject();
    try {
      compile(root);
      const staleArtifact = join(outDir, 'doomed.js');
      expect(existsSync(join(outDir, 'kept.js'))).toBe(true);
      expect(existsSync(staleArtifact)).toBe(true);

      // the source is deleted or renamed away
      rmSync(join(srcDir, 'doomed.ts'));
      compile(root);

      // witnesses the old behaviour: the artifact outlives its source
      expect(existsSync(staleArtifact)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleaning before compiling removes artifacts whose source was deleted', () => {
    const { root, srcDir, outDir } = makeProbeProject();
    try {
      compile(root);
      const staleArtifact = join(outDir, 'doomed.js');
      expect(existsSync(staleArtifact)).toBe(true);

      rmSync(join(srcDir, 'doomed.ts'));

      // this is what the fixed `build` does: clean, then compile
      rmSync(outDir, { recursive: true, force: true });
      compile(root);

      expect(existsSync(staleArtifact)).toBe(false);
      expect(existsSync(join(outDir, 'kept.js'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
