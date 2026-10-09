"use client";
import { txLink } from "@/lib/api";

interface Props {
  hash?: string | null;
  label?: string;
}

export default function TxLink({ hash, label }: Props) {
  const url = txLink(hash);
  if (!url || !hash) return <span style={{ color: "var(--muted-2)", fontSize: ".7rem" }}>—</span>;
  const short = label ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  return (
    <a className="tx-link" href={url} target="_blank" rel="noopener noreferrer">
      {short}
    </a>
  );
}
