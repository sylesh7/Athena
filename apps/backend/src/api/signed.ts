// Phase 40.4 — EIP-191 signed approver actions that are not contract calls (review queue, decision reviews).
import { recoverMessageAddress, keccak256, stringToBytes } from "viem";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { q } from "../db.js";

export interface SignedAction {
  action: string;
  target: string;
  verdict: string;
  nonce: string;
  issuedAt: string; // ISO
  signature: `0x${string}`;
}

export class SignatureError extends Error {
  constructor(public code: "bad_signature" | "not_approver" | "stale" | "replay", msg: string) {
    super(msg);
  }
}

/** Exact message the frontend signs. Keep in sync with FRONTEND_README. */
export const signedMessage = (a: Omit<SignedAction, "signature">): string =>
  `Athena review\naction: ${a.action}\ntarget: ${a.target}\nverdict: ${a.verdict}\nnonce: ${a.nonce}\nissuedAt: ${a.issuedAt}`;

const MAX_AGE_MS = 10 * 60_000;

/** Verifies signature, APPROVER_ROLE membership on-chain, freshness, and one-time nonce use. Returns the approver address. */
export async function verifySignedAction(a: SignedAction): Promise<`0x${string}`> {
  const issued = Date.parse(a.issuedAt);
  if (Number.isNaN(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS) throw new SignatureError("stale", "message older than 10 minutes");

  let signer: `0x${string}`;
  try {
    signer = await recoverMessageAddress({ message: signedMessage(a), signature: a.signature });
  } catch {
    throw new SignatureError("bad_signature", "unrecoverable signature");
  }

  const role = keccak256(stringToBytes("APPROVER_ROLE"));
  const ok = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "hasRole", args: [role, signer] })) as boolean;
  if (!ok) throw new SignatureError("not_approver", `${signer} does not hold APPROVER_ROLE`);

  const inserted = await q(
    "insert into used_nonces(nonce, address) values ($1,$2) on conflict do nothing returning nonce",
    [a.nonce, signer.toLowerCase()],
  );
  if (inserted.length === 0) throw new SignatureError("replay", "nonce already used");
  return signer;
}
