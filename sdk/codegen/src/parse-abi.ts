/**
 * parse-abi.ts
 *
 * Reads a compiled Soroban contract WASM file and extracts the contract spec
 * (ABI) using the stellar-sdk contract.Client.fromWasm API.
 */

import * as fs from 'fs';
import { contract, xdr } from '@stellar/stellar-sdk';

export interface ParsedArg {
  name: string;
  type: xdr.ScSpecTypeDef;
}

export interface ParsedFunc {
  name: string;
  doc: string;
  inputs: ParsedArg[];
  outputs: xdr.ScSpecTypeDef[];
}

export interface ParsedError {
  name: string;
  value: number;
  doc: string;
}

export interface ParsedStruct {
  name: string;
  doc: string;
  fields: ParsedArg[];
}

export interface ParsedUnion {
  name: string;
  doc: string;
  cases: Array<{ name: string; types: xdr.ScSpecTypeDef[] }>;
}

export interface ParsedEnum {
  name: string;
  doc: string;
  cases: Array<{ name: string; value: number }>;
}

export interface ContractAbi {
  funcs: ParsedFunc[];
  errors: ParsedError[];
  structs: ParsedStruct[];
  unions: ParsedUnion[];
  enums: ParsedEnum[];
}

/**
 * Parses a Soroban contract WASM file and returns the structured ABI.
 */
export async function parseWasm(wasmPath: string): Promise<ContractAbi> {
  const wasmBuffer = fs.readFileSync(wasmPath);

  // Use Client.fromWasm which handles the contractspecv0 section extraction
  const client = await contract.Client.fromWasm(wasmBuffer, {
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'http://localhost:8000/rpc',
  });

  return extractAbi(client.spec);
}

function extractAbi(spec: contract.Spec): ContractAbi {
  const funcs: ParsedFunc[] = spec.funcs().map((fn) => ({
    name: fn.name().toString(),
    doc: fn.doc().toString(),
    inputs: fn.inputs().map((inp) => ({
      name: inp.name().toString(),
      type: inp.type(),
    })),
    outputs: fn.outputs(),
  }));

  const errors: ParsedError[] = spec.errorCases().map((e) => ({
    name: e.name().toString(),
    value: e.value(),
    doc: e.doc().toString(),
  }));

  const structs: ParsedStruct[] = [];
  const unions: ParsedUnion[] = [];
  const enums: ParsedEnum[] = [];

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
    } else if (kind === 'scSpecEntryUdtUnionV0') {
      const u = entry.udtUnionV0();
      unions.push({
        name: u.name().toString(),
        doc: u.doc().toString(),
        cases: u.cases().map((c) => {
          const caseName = c.switch().name;
          if (caseName === 'scSpecUdtUnionCaseVoidV0') {
            return { name: c.voidCase().name().toString(), types: [] };
          } else {
            const tc = c.tupleCase();
            return { name: tc.name().toString(), types: tc.type() };
          }
        }),
      });
    } else if (kind === 'scSpecEntryUdtEnumV0') {
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
