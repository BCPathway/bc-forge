#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parse_abi_1 = require("./parse-abi");
const generate_1 = require("./generate");
function toPascalCase(str) {
    return str
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}
async function main() {
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
    const abi = await (0, parse_abi_1.parseWasm)(wasmPath);
    console.log(`  Found ${abi.funcs.length} function(s), ${abi.structs.length} struct(s), ` +
        `${abi.unions.length} union(s), ${abi.enums.length} enum(s), ${abi.errors.length} error(s)`);
    const code = (0, generate_1.generateBindings)(abi, contractName);
    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, code, 'utf8');
    console.log(`Generated: ${outputPath}`);
}
main().catch((err) => {
    console.error('codegen failed:', err.message);
    process.exit(1);
});
