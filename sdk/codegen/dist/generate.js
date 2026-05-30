"use strict";
/**
 * generate.ts
 *
 * Generates type-safe TypeScript client code from a parsed Soroban contract ABI.
 * Produces:
 *   - TypeScript interfaces for all struct/union/enum types
 *   - A typed client class with one method per contract function
 *   - An error enum for all contract error cases
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBindings = generateBindings;
// ─── Type Mapping ─────────────────────────────────────────────────────────────
function scSpecTypeToTs(typeDef) {
    const kind = typeDef.switch().name;
    switch (kind) {
        case 'scSpecTypeVoid': return 'void';
        case 'scSpecTypeBool': return 'boolean';
        case 'scSpecTypeU32': return 'number';
        case 'scSpecTypeI32': return 'number';
        case 'scSpecTypeU64': return 'bigint';
        case 'scSpecTypeI64': return 'bigint';
        case 'scSpecTypeU128': return 'bigint';
        case 'scSpecTypeI128': return 'bigint';
        case 'scSpecTypeU256': return 'bigint';
        case 'scSpecTypeI256': return 'bigint';
        case 'scSpecTypeString': return 'string';
        case 'scSpecTypeSymbol': return 'string';
        case 'scSpecTypeAddress': return 'string';
        case 'scSpecTypeBytes': return 'Buffer';
        case 'scSpecTypeBytesN': return 'Buffer';
        case 'scSpecTypeTimepoint': return 'bigint';
        case 'scSpecTypeDuration': return 'bigint';
        case 'scSpecTypeVal': return 'unknown';
        case 'scSpecTypeError': return 'number';
        case 'scSpecTypeOption': {
            const inner = scSpecTypeToTs(typeDef.option().valueType());
            return `${inner} | null`;
        }
        case 'scSpecTypeResult': {
            const ok = scSpecTypeToTs(typeDef.result().okType());
            const err = scSpecTypeToTs(typeDef.result().errorType());
            return `{ ok: ${ok} } | { error: ${err} }`;
        }
        case 'scSpecTypeVec': {
            const elem = scSpecTypeToTs(typeDef.vec().elementType());
            return `${elem}[]`;
        }
        case 'scSpecTypeMap': {
            const k = scSpecTypeToTs(typeDef.map().keyType());
            const v = scSpecTypeToTs(typeDef.map().valueType());
            return `Map<${k}, ${v}>`;
        }
        case 'scSpecTypeTuple': {
            const elems = typeDef.tuple().valueTypes().map(scSpecTypeToTs);
            return `[${elems.join(', ')}]`;
        }
        case 'scSpecTypeUdt': {
            return typeDef.udt().name().toString();
        }
        default:
            return 'unknown';
    }
}
// ─── Struct / Union / Enum Interfaces ─────────────────────────────────────────
function generateStructInterface(s) {
    const doc = s.doc ? `/** ${s.doc} */\n` : '';
    const fields = s.fields
        .map((f) => `  ${f.name}: ${scSpecTypeToTs(f.type)};`)
        .join('\n');
    return `${doc}export interface ${s.name} {\n${fields}\n}`;
}
function generateUnionType(u) {
    const doc = u.doc ? `/** ${u.doc} */\n` : '';
    const cases = u.cases.map((c) => {
        if (c.types.length === 0) {
            return `  | { tag: '${c.name}' }`;
        }
        const vals = c.types.map((t, i) => `value${i}: ${scSpecTypeToTs(t)}`).join('; ');
        return `  | { tag: '${c.name}'; ${vals} }`;
    });
    return `${doc}export type ${u.name} =\n${cases.join('\n')};`;
}
function generateEnumType(e) {
    const doc = e.doc ? `/** ${e.doc} */\n` : '';
    const cases = e.cases.map((c) => `  ${c.name} = ${c.value},`).join('\n');
    return `${doc}export enum ${e.name} {\n${cases}\n}`;
}
// ─── Error Enum ───────────────────────────────────────────────────────────────
function generateErrorEnum(errors, contractName) {
    if (errors.length === 0)
        return '';
    const cases = errors.map((e) => {
        const doc = e.doc ? `  /** ${e.doc} */\n` : '';
        return `${doc}  ${e.name} = ${e.value},`;
    }).join('\n');
    return `export enum ${contractName}Error {\n${cases}\n}`;
}
// ─── Method Signatures ────────────────────────────────────────────────────────
function generateMethod(fn) {
    const doc = fn.doc
        ? `  /**\n   * ${fn.doc}\n   */\n`
        : '';
    const params = fn.inputs
        .map((inp) => `${inp.name}: ${scSpecTypeToTs(inp.type)}`)
        .join(', ');
    const returnType = fn.outputs.length === 0
        ? 'void'
        : fn.outputs.length === 1
            ? scSpecTypeToTs(fn.outputs[0])
            : `[${fn.outputs.map(scSpecTypeToTs).join(', ')}]`;
    return `${doc}  ${fn.name}(${params}): Promise<${returnType}>;`;
}
// ─── Client Interface ─────────────────────────────────────────────────────────
function generateClientInterface(funcs, contractName) {
    const methods = funcs.map(generateMethod).join('\n\n');
    return `export interface ${contractName}Client {\n${methods}\n}`;
}
// ─── Main Generator ───────────────────────────────────────────────────────────
function generateBindings(abi, contractName) {
    const banner = [
        '// ─────────────────────────────────────────────────────────────────────────────',
        `// Generated by @bc-forge/codegen — DO NOT EDIT`,
        `// Contract: ${contractName}`,
        `// Generated: ${new Date().toISOString()}`,
        '// ─────────────────────────────────────────────────────────────────────────────',
        '',
    ].join('\n');
    const parts = [banner];
    // Enums
    for (const e of abi.enums) {
        parts.push(generateEnumType(e));
    }
    // Structs
    for (const s of abi.structs) {
        parts.push(generateStructInterface(s));
    }
    // Unions
    for (const u of abi.unions) {
        parts.push(generateUnionType(u));
    }
    // Error enum
    const errorEnum = generateErrorEnum(abi.errors, contractName);
    if (errorEnum)
        parts.push(errorEnum);
    // Client interface
    parts.push(generateClientInterface(abi.funcs, contractName));
    return parts.join('\n\n') + '\n';
}
