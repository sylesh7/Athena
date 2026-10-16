import { keccak256, stringToBytes } from "viem";

// Matches Solidity keccak256("VENDOR") etc.
const cat = (s: string) => keccak256(stringToBytes(s));

export const CATEGORY = {
  VENDOR: cat("VENDOR"),
  CONTRACTOR: cat("CONTRACTOR"),
  SUBSCRIPTION: cat("SUBSCRIPTION"),
  SERVICES: cat("SERVICES"),
  YIELD: cat("YIELD"),
  FX: cat("FX"),
} as const;
export type CategoryName = keyof typeof CATEGORY;
