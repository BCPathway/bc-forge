import { describe, it, expect, vi } from 'vitest';
import {
  buildBindingsArgs,
  generateBindings,
  resolveBinary,
  BindingsOptionError,
  SUPPORTED_LANGUAGES,
  type CommandRunner
} from '../commands/generate-bindings.js';

const CONTRACT_ID = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';

/** Runner stub that records the invocation and returns a scripted result. */
function stubRunner(
  result: Partial<{ exitCode: number | null; stdout: string; stderr: string }> = {}
) {
  return vi.fn(async () => ({
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  })) as unknown as CommandRunner & ReturnType<typeof vi.fn>;
}

describe('CLI generate-bindings command (#701)', () => {
  describe('buildBindingsArgs', () => {
    it('builds a typescript invocation from a local wasm artifact', () => {
      const args = buildBindingsArgs({
        language: 'typescript',
        wasm: './token.wasm',
        outputDir: './packages/token'
      });

      expect(args).toEqual([
        'contract',
        'bindings',
        'typescript',
        '--wasm',
        './token.wasm',
        '--output-dir',
        './packages/token'
      ]);
    });

    it('passes network options when generating from a deployed contract', () => {
      const args = buildBindingsArgs({
        language: 'typescript',
        contractId: CONTRACT_ID,
        outputDir: './out',
        rpcUrl: 'https://rpc.example',
        networkPassphrase: 'Test SDF Network ; September 2015'
      });

      expect(args).toContain('--contract-id');
      expect(args).toContain(CONTRACT_ID);
      expect(args).toContain('--rpc-url');
      expect(args).toContain('https://rpc.example');
      expect(args).toContain('--network-passphrase');
    });

    it('omits network options when generating from a local wasm', () => {
      const args = buildBindingsArgs({
        language: 'typescript',
        wasm: './token.wasm',
        outputDir: './out',
        rpcUrl: 'https://rpc.example',
        networkPassphrase: 'Test SDF Network ; September 2015'
      });

      expect(args).not.toContain('--rpc-url');
      expect(args).not.toContain('--network-passphrase');
    });

    it('appends --overwrite when requested', () => {
      const args = buildBindingsArgs({
        language: 'typescript',
        wasm: './token.wasm',
        outputDir: './out',
        overwrite: true
      });

      expect(args).toContain('--overwrite');
    });

    it('builds a rust invocation with only the wasm flag', () => {
      const args = buildBindingsArgs({ language: 'rust', wasm: './token.wasm' });

      expect(args).toEqual(['contract', 'bindings', 'rust', '--wasm', './token.wasm']);
      expect(args).not.toContain('--output-dir');
    });

    it('supports every language the Stellar CLI exposes', () => {
      for (const language of SUPPORTED_LANGUAGES) {
        const args = buildBindingsArgs({
          language,
          wasm: './token.wasm',
          outputDir: './out'
        });
        expect(args.slice(0, 3)).toEqual(['contract', 'bindings', language]);
      }
    });

    it('rejects an unsupported language', () => {
      expect(() =>
        buildBindingsArgs({ language: 'cobol', wasm: './t.wasm', outputDir: './out' })
      ).toThrow(BindingsOptionError);
    });

    it('rejects a missing contract source', () => {
      expect(() => buildBindingsArgs({ language: 'typescript', outputDir: './out' })).toThrow(
        /exactly one of --wasm/
      );
    });

    it('rejects more than one contract source', () => {
      expect(() =>
        buildBindingsArgs({
          language: 'typescript',
          wasm: './t.wasm',
          contractId: CONTRACT_ID,
          outputDir: './out'
        })
      ).toThrow(/mutually exclusive/);
    });

    it('rejects a missing output directory for languages that require one', () => {
      expect(() => buildBindingsArgs({ language: 'typescript', wasm: './t.wasm' })).toThrow(
        /--output-dir is required/
      );
    });

    it('rejects a network source for the rust generator, which reads local wasm only', () => {
      expect(() =>
        buildBindingsArgs({ language: 'rust', contractId: CONTRACT_ID })
      ).toThrow(/reads a local build only/);
    });
  });

  describe('resolveBinary', () => {
    it('defaults to the stellar binary', () => {
      const previous = { ...process.env };
      delete process.env.STELLAR_CLI_BIN;
      delete process.env.SOROBAN_CLI_BIN;

      expect(resolveBinary()).toBe('stellar');

      process.env = previous;
    });

    it('honours an overridden binary path', () => {
      const previous = process.env.STELLAR_CLI_BIN;
      process.env.STELLAR_CLI_BIN = '/opt/soroban';

      expect(resolveBinary()).toBe('/opt/soroban');

      if (previous === undefined) delete process.env.STELLAR_CLI_BIN;
      else process.env.STELLAR_CLI_BIN = previous;
    });
  });

  describe('generateBindings', () => {
    it('reports success when the generator exits cleanly', async () => {
      const runner = stubRunner({ exitCode: 0, stdout: 'Generated!' });

      const result = await generateBindings(
        { language: 'typescript', wasm: './token.wasm', outputDir: './out' },
        runner,
        'stellar'
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Generated!');
      expect(runner).toHaveBeenCalledWith('stellar', [
        'contract',
        'bindings',
        'typescript',
        '--wasm',
        './token.wasm',
        '--output-dir',
        './out'
      ]);
    });

    it('reports failure and surfaces stderr when the generator exits non-zero', async () => {
      const runner = stubRunner({ exitCode: 1, stderr: 'error: invalid wasm' });

      const result = await generateBindings(
        { language: 'typescript', wasm: './bad.wasm', outputDir: './out' },
        runner,
        'stellar'
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/exited with code 1/);
      expect(result.error).toMatch(/invalid wasm/);
    });

    it('reports an install hint when the Stellar CLI is not on PATH', async () => {
      const runner = vi.fn(async () => {
        const err: any = new Error('spawn stellar ENOENT');
        err.code = 'ENOENT';
        throw err;
      }) as unknown as CommandRunner;

      const result = await generateBindings(
        { language: 'typescript', wasm: './token.wasm', outputDir: './out' },
        runner,
        'stellar'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Install the Stellar CLI/);
      expect(result.error).toMatch(/STELLAR_CLI_BIN/);
    });

    it('does not invoke the generator when the options are invalid', async () => {
      const runner = stubRunner();

      const result = await generateBindings(
        { language: 'typescript', outputDir: './out' },
        runner,
        'stellar'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exactly one of --wasm/);
      expect(runner).not.toHaveBeenCalled();
    });
  });
});
