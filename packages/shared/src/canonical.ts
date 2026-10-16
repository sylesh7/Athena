import canonicalizeImport from "canonicalize";
import { createHash } from "node:crypto";
import { bytesToHex, type Hex } from "viem";

// canonicalize ships CJS typings that NodeNext sees as a namespace; resolve the callable either way.
const canonicalize = ((canonicalizeImport as unknown as { default?: unknown }).default ?? canonicalizeImport) as (v: unknown) => string | undefined;

export interface CanonicalRecord {
  json: string; // canonical JSON text (RFC 8785)
  bytes: Hex; // UTF-8 bytes as 0x-hex — exactly what reveal() receives
  sha256: Hex; // 0x-prefixed — what commit() receives
}

/**
 * Amounts inside records must be strings of atomic units, rates integers (bps), no `undefined`.
 * Once committed a record is immutable: persist `json`/`bytes` BEFORE calling commit().
 */
export function canonicalRecord(obj: unknown): CanonicalRecord {
  const json = canonicalize(obj);
  if (json === undefined) throw new Error("record is not serializable");
  const buf = Buffer.from(json, "utf8");
  return {
    json,
    bytes: bytesToHex(buf),
    sha256: `0x${createHash("sha256").update(buf).digest("hex")}`,
  };
}

export const sha256Hex = (data: Buffer | string): Hex => `0x${createHash("sha256").update(data).digest("hex")}`;
