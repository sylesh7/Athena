import raw from "../addresses.json" with { type: "json" };
import type { Network } from "./chains.js";

export type NetCfg = (typeof raw)["testnet"];

export function net(n: Network): NetCfg {
  return raw[n] as unknown as NetCfg;
}

export const destinations = raw.destinations;

/** `null` means "not verified for this network yet": refuse the feature rather than guess. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is not configured for this network. Verify it and add it to addresses.json.`);
  }
  return value;
}
