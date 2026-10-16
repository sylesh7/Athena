// Phase 33.2 — relay the mint. Triggered by CrossChainPaymentInitiated (indexer inserts a `burned` row). No attestation is
// ever fabricated: Circle's Iris service signs it and receiveMessage verifies that signature on-chain. destinationCaller is 0,
// so anyone can complete the mint — if this relayer is down a human can paste the message + attestation into any wallet.
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { destinations, net } from "@athena/shared/addresses";
import { commonCfg } from "../config.js";
import { q, notify } from "../db.js";
import { log } from "../log.js";

interface Row { id: number; burn_tx: string; destination_domain: number; status: string; message: string | null; attestation: string | null }

const receiveAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);

// Fast transfers usually attest in about a minute on testnet; poll up to ~5 minutes per call, then leave it `burned`
// so the next tick keeps polling.
async function fetchAttestation(irisApi: string, burnTx: string): Promise<{ message: string; attestation: string } | null> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${irisApi}/v2/messages/26?transactionHash=${burnTx}`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const body = (await r.json()) as { messages?: Array<{ status?: string; attestation?: string; message?: string }> };
        const m = body.messages?.[0];
        if (m?.status === "complete" && m.attestation && m.message) return { message: m.message, attestation: m.attestation };
      }
    } catch { /* transient: keep polling */ }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

export async function relayPending(relayerPk: string | undefined): Promise<number> {
  if (!relayerPk) return 0;
  const n = net(commonCfg.NETWORK);
  const rows = await q<Row>("select id, burn_tx, destination_domain, status, message, attestation from cross_chain_transfers where direction = 'cctp_out' and status in ('burned','attested') order by id limit 5");
  let minted = 0;
  for (const t of rows) {
    // Only Base Sepolia is configured as a destination; other domains are left for a human until verified.
    if (t.destination_domain !== destinations.baseSepolia.cctpDomain) { log.warn({ domain: t.destination_domain }, "no relayer config for domain — skipping"); continue; }
    try {
      let { message, attestation } = t;
      if (!message || !attestation) {
        const a = await fetchAttestation(n.cctp.irisApi, t.burn_tx);
        if (!a) { log.warn({ burnTx: t.burn_tx }, "attestation not ready yet"); continue; }
        ({ message, attestation } = a);
        await q("update cross_chain_transfers set message = $2, attestation = $3, status = 'attested', updated_at = now() where id = $1", [t.id, message, attestation]);
        await notify("crosschain.stage", { id: t.id, stage: "attested" });
      }
      const account = privateKeyToAccount(relayerPk as `0x${string}`);
      const pub = createPublicClient({ chain: baseSepolia, transport: http(destinations.baseSepolia.rpcPublic) });
      const wallet = createWalletClient({ chain: baseSepolia, transport: http(destinations.baseSepolia.rpcPublic), account });
      const { request } = await pub.simulateContract({
        account, address: destinations.baseSepolia.messageTransmitterV2 as `0x${string}`, abi: receiveAbi, functionName: "receiveMessage",
        args: [message as `0x${string}`, attestation as `0x${string}`],
      });
      const hash = await wallet.writeContract(request);
      await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      await q("update cross_chain_transfers set mint_tx = $2, status = 'minted', updated_at = now() where id = $1", [t.id, hash]);
      await notify("crosschain.stage", { id: t.id, stage: "minted", mintTx: hash });
      minted++;
    } catch (err) {
      // A message that was already received reverts here; that is not a failure of the payout, but we cannot tell the
      // difference blindly — leave it for a human rather than marking it minted.
      log.error({ id: t.id, err: String(err) }, "relay failed — will retry");
    }
  }
  return minted;
}
