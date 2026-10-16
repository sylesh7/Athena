import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

const enc = (types: { type: string }[], values: unknown[]): Hex =>
  keccak256(encodeAbiParameters(types as never, values as never));

/** Invoice fingerprint → obligation id. Same invoice ⇒ same id, forever. */
export const obligationId = (treasury: Address, fingerprint: Hex): Hex =>
  enc([{ type: "string" }, { type: "address" }, { type: "bytes32" }], ["athena.obligation.v1", treasury, fingerprint]);

/** One id per decision in a cycle. */
export const decisionId = (treasury: Address, cycleId: string, index: number): Hex =>
  enc(
    [{ type: "string" }, { type: "address" }, { type: "string" }, { type: "uint256" }],
    ["athena.decision.v1", treasury, cycleId, BigInt(index)],
  );

/** Stable payee id from a slug chosen at onboarding (e.g. "vendor:northwind-hosting"). */
export const payeeId = (treasury: Address, slug: string): Hex =>
  enc([{ type: "string" }, { type: "address" }, { type: "string" }], ["athena.payee.v1", treasury, slug]);

export const receivableId = (treasury: Address, invoiceNumber: string): Hex =>
  enc([{ type: "string" }, { type: "address" }, { type: "string" }], ["athena.receivable.v1", treasury, invoiceNumber]);
