// Phase 36 — buying services over x402. The spend wallet (an EOA, because GatewayClient signs locally) pays services from its
// Gateway balance, which the treasury keeps topped up through committed TOP_UP_SERVICES decisions (SERVICES budget). Each
// purchase is recorded with its real cost and latency; the usage counts are the independent "meter" for the three-way match
// of usage-billed invoices (Phase 36.4): the vendor does not get to supply both the goods and the measuring cup.
import { q } from "../db.js";
import { log } from "../log.js";
import { buyService } from "../gateway/gateway.js";

/** Hourly cadence per URL: cheap, real nanopayments that show up as traction without hammering the service. */
export const PURCHASE_INTERVAL_MINUTES = 60;

export async function runServicePurchases(args: { spendPk: string | undefined; urls: string | undefined; network: string }): Promise<number> {
  if (!args.spendPk || !args.urls) return 0;
  let n = 0;
  for (const url of args.urls.split(",").map((u) => u.trim()).filter(Boolean)) {
    const last = (await q<{ at: Date | null }>("select max(created_at) as at from service_purchases where url = $1 and ok", [url]))[0]?.at;
    if (last && Date.now() - new Date(last).getTime() < PURCHASE_INTERVAL_MINUTES * 60_000) continue;
    const meterKey = new URL(url).pathname.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "service";
    const r = await buyService({ spendPk: args.spendPk, url, meterKey, network: args.network });
    if (r.ok) n++;
    else log.warn({ url }, "service purchase did not succeed this cycle");
  }
  return n;
}

/** Independent usage meter: successful purchases of a meter key in a window (compare against a vendor's usage invoice). */
export async function meteredUnits(meterKey: string, sinceIso: string, untilIso: string): Promise<number> {
  return Number((await q<{ n: string }>("select count(*)::text n from service_purchases where meter_key = $1 and ok and created_at >= $2 and created_at < $3", [meterKey, sinceIso, untilIso]))[0]!.n);
}
