"use client";
import { formatUnits } from "@/lib/api";

interface Props {
  value: string | bigint;
  token?: string;
  className?: string;
}

export default function Amount({ value, token = "USDC", className }: Props) {
  return (
    <span className={`mono ${className ?? ""}`}>
      {formatUnits(value)} <span style={{ color: "var(--muted)", fontSize: ".85em" }}>{token}</span>
    </span>
  );
}
