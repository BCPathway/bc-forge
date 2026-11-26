// SPDX-License-Identifier: MIT
/**
 * Webhook target URL safety checks (#1320).
 *
 * Webhook registrations are attacker-controlled from the perspective of the
 * API caller: without validation, a subsequent delivery could be pointed at
 * loopback interfaces, private RFC 1918 networks, link-local/cloud metadata
 * addresses, or internal-only hostnames (SSRF).
 *
 * The checks are synchronous for literal IPs and hostnames, and optionally
 * resolve DNS before persisting a target so a public-looking hostname cannot
 * redirect delivery into an internal network. A resolver can be injected by
 * tests; production uses `dns.promises.lookup`.
 */

import { isIP } from "node:net";
import { promises as dns } from "node:dns";

export type DnsResolver = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultResolver: DnsResolver = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true });
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family,
  }));
};

let resolver: DnsResolver = defaultResolver;

/** Test hook: replace (or reset with no argument) the DNS resolver. */
export function setWebhookDnsResolverForTests(next?: DnsResolver): void {
  resolver = next ?? defaultResolver;
}

function parseIpv4(value: string): number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return undefined;
    octets.push(octet);
  }
  return octets;
}

/** Returns true when a literal IP is loopback, private, link-local, or reserved. */
export function isInternalIp(address: string): boolean {
  const version = isIP(address);
  const withoutZone = address.split("%")[0];

  if (version === 4) {
    const octets = parseIpv4(withoutZone);
    if (!octets) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (version === 6) {
    const lower = withoutZone.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped forms: ::ffff:127.0.0.1 etc.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isInternalIp(mapped[1]);
    // Unique local fc00::/7 and link-local fe80::/10.
    const first = Number.parseInt(lower.slice(0, 2), 16);
    if (Number.isFinite(first)) {
      if ((first & 0xfe00) === 0xfc00) return true;
      if ((first & 0xffc0) === 0xfe80) return true;
    }
    return false;
  }

  // Unknown literal form: fail closed.
  return true;
}

const INTERNAL_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

function hostnameIsInternal(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (INTERNAL_HOSTNAMES.has(lower)) return true;
  if (
    lower.endsWith(".localhost") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".local")
  ) {
    return true;
  }
  return false;
}

export interface UrlSafetyResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Validates a webhook target without performing any network I/O for literal
 * IPs. Hostnames are resolved with the injected resolver (production: DNS).
 */
export async function validateWebhookUrl(
  rawUrl: unknown,
): Promise<UrlSafetyResult> {
  if (typeof rawUrl !== "string") {
    return { ok: false, reason: "url must be an HTTPS URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "url must be an HTTPS URL" };
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return {
      ok: false,
      reason: "url must be an HTTPS URL without embedded credentials",
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (hostnameIsInternal(hostname)) {
    return { ok: false, reason: "url must target a public host" };
  }

  if (isIP(hostname)) {
    return isInternalIp(hostname)
      ? { ok: false, reason: "url must target a public host" }
      : { ok: true };
  }

  let addresses: ReadonlyArray<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    // A hostname we cannot resolve cannot be verified as public.
    return { ok: false, reason: "url must target a resolvable public host" };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "url must target a resolvable public host" };
  }
  if (addresses.some((entry) => isInternalIp(entry.address))) {
    return { ok: false, reason: "url must target a public host" };
  }
  return { ok: true };
}
