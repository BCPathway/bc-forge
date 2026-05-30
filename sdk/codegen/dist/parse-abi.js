"use strict";
/**
 * parse-abi.ts
 *
 * Reads a compiled Soroban contract WASM file and extracts the contract spec
 * (ABI) using the stellar-sdk contract.Client.fromWasm API.
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
exports.parseWasm = parseWasm;
const fs = __importStar(require("fs"));
const stellar_sdk_1 = require("@stellar/stellar-sdk");
/**
 * Parses a Soroban contract WASM file and returns the structured ABI.
 */
async function parseWasm(wasmPath) {
    const wasmBuffer = fs.readFileSync(wasmPath);
    // Use Client.fromWasm which handles the contractspecv0 section extraction
    const client = await stellar_sdk_1.contract.Client.fromWasm(wasmBuffer, {
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'http://localhost:8000/rpc',
    });
    return extractAbi(client.spec);
}
function extractAbi(spec) {
    const funcs = spec.funcs().map((fn) => ({
        name: fn.name().toString(),
        doc: fn.doc().toString(),
        inputs: fn.inputs().map((inp) => ({
            name: inp.name().toString(),
            type: inp.type(),
        })),
        outputs: fn.outputs(),
    }));
    const errors = spec.errorCases().map((e) => ({
        name: e.name().toString(),
        value: e.value(),
        doc: e.doc().toString(),
    }));
    const structs = [];
    const unions = [];
    const enums = [];
    for (const entry of spec.entries) {
        const kind = entry.switch().name;
        if (kind === 'scSpecEntryUdtStructV0') {
            const s = entry.udtStructV0();
            structs.push({
                name: s.name().toString(),
                doc: s.doc().toString(),
                fields: s.fields().map((f) => ({
                    name: f.name().toString(),
                    type: f.type(),
                })),
            });
        }
        else if (kind === 'scSpecEntryUdtUnionV0') {
            const u = entry.udtUnionV0();
            unions.push({
                name: u.name().toString(),
                doc: u.doc().toString(),
                cases: u.cases().map((c) => {
                    const caseName = c.switch().name;
                    if (caseName === 'scSpecUdtUnionCaseVoidV0') {
                        return { name: c.voidCase().name().toString(), types: [] };
                    }
                    else {
                        const tc = c.tupleCase();
                        return { name: tc.name().toString(), types: tc.type() };
                    }
                }),
            });
        }
        else if (kind === 'scSpecEntryUdtEnumV0') {
            const e = entry.udtEnumV0();
            enums.push({
                name: e.name().toString(),
                doc: e.doc().toString(),
                cases: e.cases().map((c) => ({
                    name: c.name().toString(),
                    value: c.value(),
                })),
            });
        }
    }
    return { funcs, errors, structs, unions, enums };
}
