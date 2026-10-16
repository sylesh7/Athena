import { encodeAbiParameters, keccak256, zeroHash, type Address, type Hex } from "viem";

export const KIND = { PAY: 1, RESERVE: 2, RELEASE_RESERVE: 3 } as const;

export interface Action {
  kind: number;
  obligationId: Hex;
  payeeId: Hex;
  token: Address;
  amount: bigint;
  maxFee: bigint;
  evidenceHash: Hex;
}

export const ACTION_TUPLE = {
  type: "tuple",
  components: [
    { name: "kind", type: "uint8" },
    { name: "obligationId", type: "bytes32" },
    { name: "payeeId", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

/** Must equal AthenaTreasury.hashAction(a) = keccak256(abi.encode(a)). */
export const actionHash = (a: Action): Hex => keccak256(encodeAbiParameters([ACTION_TUPLE], [a]));

/** Decisions with no on-chain action (hold, schedule, redeem, consolidate) commit actionHash = 0. */
export const NO_ACTION: Hex = zeroHash;
