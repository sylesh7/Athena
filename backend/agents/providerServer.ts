/**
 * agents/providerServer.ts — shared scaffolding for the 3 x402 provider
 * endpoints (Phase 2.1). Each provider still owns its own real data-fetching
 * logic in provider1.ts/provider2.ts/provider3.ts; this only factors out the
 * Gateway middleware wiring, latency timing, and error shape that's
 * genuinely identical across all three.
 */

import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import express, { type Request } from "express";

export interface ProviderCallResult {
  data: Record<string, unknown>;
  qualityScore: number; // 0..1 — provider's own confidence in the data it just returned
}

interface TimedRequest extends Request {
  startTime?: number;
}

export function createProviderApp(opts: {
  sellerAddress: string;
  pricePerCallUsdc: string; // e.g. "$0.000001"
  route: string;
  handler: () => Promise<ProviderCallResult>;
}) {
  const app = express();

  const gateway = createGatewayMiddleware({
    sellerAddress: opts.sellerAddress,
    // facilitatorUrl defaults to Circle's hosted Arc testnet facilitator
    // (https://gateway-api-testnet.circle.com); network eip155:5042002 is
    // inferred from ARC-TESTNET.
  });

  app.get(
    opts.route,
    (req: TimedRequest, _res, next) => {
      req.startTime = Date.now();
      next();
    },
    gateway.require(opts.pricePerCallUsdc),
    async (req: TimedRequest, res) => {
      const startTime = req.startTime ?? Date.now();
      try {
        const { data, qualityScore } = await opts.handler();
        res.json({
          ...data,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          qualityScore,
        });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "upstream data source failed",
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          qualityScore: 0,
        });
      }
    }
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}
