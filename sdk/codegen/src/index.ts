#!/usr/bin/env node
/**
 * index.ts — CLI entry point for @bc-forge/codegen
 *
 * Usage:
 *   bc-forge-codegen <wasm-path> [output-path] [--name <ContractName>]
 *
 * Defaults:
 *   output-path  → sdk/src/generated-client.ts
 *   name         → derived from wasm filename (snake_case → PascalCase)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWasm } from './parse-abi';
import { generateBindings } from './generate';

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: bc-forge-codegen <wasm-path> [output-path] [--name <ContractName>]

  wasm-path    Path to the compiled .wasm file
  output-path  Output .ts file (default: sdk/src/generated-client.ts)
  --name       Contract name for generated types (default: derived from filename)

Example:
  bc-forge-codegen target/wasm32-unknown-unknown/release/bc_forge_token.wasm
`);
    process.exit(0);
  }

  const wasmPath = args[0];
  if (!fs.existsSync(wasmPath)) {
    console.error(`Error: WASM file not found: ${wasmPath}`);
    process.exit(1);
  }

  // Determine output path
  let outputPath = args[1] && !args[1].startsWith('--')
    ? args[1]
    : path.resolve(__dirname, '../../../src/generated-client.ts');

  // Determine contract name
  const nameIdx = args.indexOf('--name');
  const contractName = nameIdx !== -1 && args[nameIdx + 1]
    ? args[nameIdx + 1]
    : toPascalCase(path.basename(wasmPath, '.wasm'));

  console.log(`Parsing WASM: ${wasmPath}`);
  const abi = await parseWasm(wasmPath);

  console.log(`  Found ${abi.funcs.length} function(s), ${abi.structs.length} struct(s), ` +
    `${abi.unions.length} union(s), ${abi.enums.length} enum(s), ${abi.errors.length} error(s)`);

  const code = generateBindings(abi, contractName);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, code, 'utf8');

  console.log(`Generated: ${outputPath}`);
}

main().catch((err) => {
  console.error('codegen failed:', err.message);
  process.exit(1);
});
