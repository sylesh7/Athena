/**
 * agents/broker.ts — Athena's routing decision.
 *
 * Deterministic discover → score → select → predict pipeline. No agent
 * framework: the Circle Agent Wallet (wallets/setup.ts) is Athena's identity
 * and payment account, this is just the decision logic on top of it. See
 * BACKEND_B_README.md Phase 3.3 for the rationale.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAbi } from "viem";
import { addresses, unitsToUsdc } from "../lib/config.js";
import { publicClient } from "../lib/chain.js";

const execFileAsync = promisify(execFile);

export interface DiscoveredProvider {
  address: `0x${string}`;
  url: string;
  name: string;
  category: string;
  pricePerCallUsdc: number;
  endpointCount: number;
}

export interface ReputationSummary {
  avgQuality: number | null;
  avgLatencyMs: number | null;
  sampleSize: number;
}

export interface ScoredProvider extends DiscoveredProvider {
  reputation: ReputationSummary;
  score: number;
}

export interface RoutingDecision {
  selectedProvider: ScoredProvider;
  predictedQualityScore: number;
  predictedLatencyMs: number;
  confidenceScore: number;
}

// ── 1. Discovery ──────────────────────────────────────────────────────────

const ARC_TESTNET_CAIP2 = `eip155:${addresses.chainId}`; // "eip155:5042002"

// Athena's own 3 registered providers — same ports/routes/prices
// test/smoke.ts's health checks already use (agents/provider{1,2,3}.ts).
// This is the fallback discoverProviders() returns to below, NOT a shortcut
// around real discovery: a live `circle services search` run (2026-07-05,
// category FINANCIAL_ANALYSIS, 50 results) confirmed the Circle Agent
// Marketplace currently has ZERO listings anywhere with an `accepts[]`
// entry on eip155:5042002 (Arc Testnet) — every real listing was Base/
// Polygon/Ethereum mainnet/Avalanche/etc. So even with fully-correct
// parsing, marketplace-only discovery cannot currently route to any
// provider on our chain, including our own. Real discovery still runs
// first every time; this only fills in when it comes back empty.
function requireAgent(name: string) {
  const agent = addresses.agents[name];
  if (!agent) throw new Error(`shared/addresses.json has no "${name}" agent entry`);
  return agent;
}

const KNOWN_ARC_PROVIDERS: DiscoveredProvider[] = [
  {
    address: requireAgent("provider1").address as `0x${string}`,
    url: `http://localhost:${process.env.PROVIDER1_PORT ?? 3001}/price/usdc-eth`,
    name: requireAgent("provider1").name,
    category: "FINANCIAL_ANALYSIS",
    pricePerCallUsdc: 0.000001,
    endpointCount: 1,
  },
  {
    address: requireAgent("provider2").address as `0x${string}`,
    url: `http://localhost:${process.env.PROVIDER2_PORT ?? 3002}/analytics/eth`,
    name: requireAgent("provider2").name,
    category: "FINANCIAL_ANALYSIS",
    pricePerCallUsdc: 0.000001,
    endpointCount: 1,
  },
  {
    address: requireAgent("provider3").address as `0x${string}`,
    url: `http://localhost:${process.env.PROVIDER3_PORT ?? 3003}/price/feed`,
    name: requireAgent("provider3").name,
    category: "FINANCIAL_ANALYSIS",
    pricePerCallUsdc: 0.000001,
    endpointCount: 1,
  },
];

/**
 * Lists x402 provider agents from Circle's Agent Marketplace via the Circle
 * CLI's `services search` verb (confirmed live 2026-07-05 — the previously
 * assumed `services list` verb doesn't exist: "Unknown verb 'list' for
 * resource 'services'"; real verbs are search/inspect/pay, there's no
 * --chain flag, and --category must be UPPER_SNAKE_CASE, e.g.
 * FINANCIAL_ANALYSIS). Real response shape, confirmed from a live run:
 * `{ data: { items: [{ resource, accepts: [{ network, payTo, amount, ... }],
 * metadata: { provider: { name, category, ... } } }] } }` — nothing like the
 * flat array previously assumed. Filters `accepts[]` down to whichever entry
 * (if any) pays out on Arc Testnet, since that's the only chain this system
 * can actually route/pay on; a listing with no Arc-Testnet `accepts` entry
 * is not something we can use no matter how well-reputed it is.
 *
 * Falls back to KNOWN_ARC_PROVIDERS if the marketplace search errors out or
 * returns zero Arc-Testnet-compatible results — see that constant's comment
 * for why this isn't just theoretical.
 */
export async function discoverProviders(category: string): Promise<DiscoveredProvider[]> {
  let marketplaceProviders: DiscoveredProvider[] = [];

  try {
    const { stdout } = await execFileAsync("circle", [
      "services",
      "search",
      "--category",
      category,
      "--output",
      "json",
    ]);

    const raw = JSON.parse(stdout);
    const items: unknown[] = raw?.data?.items ?? [];

    marketplaceProviders = items
      .map((entry): DiscoveredProvider | null => {
        const e = entry as Record<string, unknown>;
        const accepts = (e.accepts ?? []) as Array<Record<string, unknown>>;
        const arcAccept = accepts.find((a) => a.network === ARC_TESTNET_CAIP2);
        if (!arcAccept) return null; // real listing, but can't pay it on our chain

        const metadata = (e.metadata ?? {}) as Record<string, unknown>;
        const provider = (metadata.provider ?? {}) as Record<string, unknown>;

        return {
          address: arcAccept.payTo as `0x${string}`,
          url: String(e.resource ?? ""),
          name: String(provider.name ?? e.resource ?? "unknown"),
          category: String(provider.category ?? category),
          pricePerCallUsdc: unitsToUsdc(BigInt((arcAccept.amount as string) ?? "0")),
          endpointCount: 1,
        };
      })
      .filter((p): p is DiscoveredProvider => p !== null);
  } catch (err) {
    console.error(
      `circle services search failed — falling back to Athena's own registered providers only:`,
      err
    );
  }

  if (marketplaceProviders.length === 0) {
    console.warn(
      `circle services search returned zero providers with an Arc Testnet (${ARC_TESTNET_CAIP2}) payment ` +
        `option for category "${category}". Falling back to Athena's own 3 registered providers ` +
        `(KNOWN_ARC_PROVIDERS) so routing can still happen.`
    );
    return KNOWN_ARC_PROVIDERS;
  }

  return marketplaceProviders;
}

// ── 2. Scoring — ERC-8004 reputation lookup ─────────────────────────────────

// Matches the REAL deployed ERC-8004 reputation registry (impl 0x16e0…,
// verified on Arcscan 2026-07-05), NOT contracts/src/interfaces/IERC8004.sol,
// whose `readAllFeedback(uint256) returns (bytes)` doesn't exist on-chain and
// reverted for every provider. `getSummary` returns a ready-made aggregate
// (count + average) — but it REVERTS with "clientAddresses required" on an
// empty client list, so we first fetch the real client set via getClients().
const reputationAbi = parseAbi([
  "function getClients(uint256 agentId) external view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

// Looks up an agent's ERC-8004 tokenId from shared/addresses.json rather than
// an on-chain address->tokenId call. There is no such call: the real
// IdentityRegistry (contracts/src/interfaces/IERC8004.sol) only exposes
// `register`, `ownerOf(tokenId)`, `tokenURI(tokenId)` — no reverse lookup.
// A prior version of this file called an invented `tokenOfOwner(address)`
// function that doesn't exist on the deployed contract, which reverted for
// every provider (confirmed live 2026-07-05). Backend A already records each
// agent's real tokenId at registration time, so this is both simpler and
// the only thing that actually works.
function findAgentTokenId(address: `0x${string}`): bigint | null {
  const agent = Object.values(addresses.agents).find((a) => a.address.toLowerCase() === address.toLowerCase());
  return agent ? BigInt(agent.tokenId) : null;
}

/**
 * Reads a provider's ERC-8004 reputation via the registry's `getSummary`,
 * an aggregate of all feedback for the agent. Two-step because `getSummary`
 * reverts on an empty client list: first `getClients(agentId)` for the real
 * set of feedback authors, then `getSummary(agentId, clients, "", "")`.
 *
 * `summaryValue` is the plain average on our 0-100 posting scale
 * (lib/reputation.ts posts integer 0-100 scores) — verified live against
 * readFeedback + per-client getSummary on this deployment: e.g. 5 scores of
 * 100 + 2 of 90 => summaryValue 97, i.e. the average is NOT further scaled by
 * the `summaryValueDecimals` field on this contract. So `avgQuality =
 * summaryValue / 100` (clamped 0-1). `count` is the real sample size.
 *
 * If any read reverts (genuinely unregistered agent, or an ABI drift) we fall
 * back to a neutral "no track record yet" summary rather than throwing, so a
 * first-ever stream to a brand-new provider can still route.
 */
export async function readErc8004Reputation(providerAddress: `0x${string}`): Promise<ReputationSummary> {
  const empty: ReputationSummary = { avgQuality: null, avgLatencyMs: null, sampleSize: 0 };
  const reputation = addresses.contracts.erc8004Reputation as `0x${string}`;

  try {
    const tokenId = findAgentTokenId(providerAddress);
    if (tokenId === null) return empty; // not one of Athena's registered agents — no history to read

    const clients = await publicClient.readContract({
      address: reputation,
      abi: reputationAbi,
      functionName: "getClients",
      args: [tokenId],
    });
    if (clients.length === 0) return empty; // registered, but no feedback yet (getSummary would revert)

    const [count, summaryValue] = await publicClient.readContract({
      address: reputation,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [tokenId, [...clients], "", ""], // "" tags => all feedback across all tags
    });
    if (count === 0n) return empty;

    const avgQuality = Math.max(0, Math.min(1, Number(summaryValue) / 100));
    return { avgQuality, avgLatencyMs: null, sampleSize: Number(count) };
  } catch (err) {
    // Logged, not swallowed: a real read failure and "provider genuinely has
    // no history yet" must not look identical in the logs, even though both
    // fall back to the same neutral score for routing purposes.
    console.error(
      `readErc8004Reputation(${providerAddress}) failed — falling back to neutral score. ` +
        `This could mean a genuinely unregistered provider, OR that ERC-8004's getSummary/getClients ABI ` +
        `has drifted from the shape used here (re-verify against Arcscan):`,
      err
    );
    return empty;
  }
}

export async function scoreProviders(providers: DiscoveredProvider[]): Promise<ScoredProvider[]> {
  return Promise.all(
    providers.map(async (p) => {
      const reputation = await readErc8004Reputation(p.address);
      const score = weightedScore(p, reputation);
      return { ...p, reputation, score };
    })
  );
}

function weightedScore(p: DiscoveredProvider, rep: ReputationSummary): number {
  const reputationTerm = (rep.avgQuality ?? 0.7) * 0.6; // unproven providers get a modest, not zero, prior
  const confidenceTerm = Math.min(rep.sampleSize / 10, 1) * 0.1; // more history = more trustworthy signal
  const priceTerm = p.pricePerCallUsdc > 0 ? Math.min(0.000001 / p.pricePerCallUsdc, 1) * 0.2 : 0.2;
  const endpointTerm = Math.min(p.endpointCount / 5, 1) * 0.1;
  return reputationTerm + confidenceTerm + priceTerm + endpointTerm;
}

// ── 3. Selection ─────────────────────────────────────────────────────────

export function selectProvider(scored: ScoredProvider[]): ScoredProvider {
  if (scored.length === 0) throw new Error("No providers discovered — nothing to route to");
  return scored.reduce((best, p) => (p.score > best.score ? p : best));
}

// ── 4. Prediction ────────────────────────────────────────────────────────

/**
 * Falsifiable, checkable prediction derived from the selected provider's own
 * historical averages (not LLM prose) — this is the number the bond is
 * actually staked against. Providers with fewer than 5 prior feedback entries
 * get a conservative default and a lower confidence score, since the
 * prediction is a guess rather than an evidenced estimate.
 */
export function predictOutcome(selected: ScoredProvider): Omit<RoutingDecision, "selectedProvider"> {
  const hasHistory = selected.reputation.sampleSize >= 5;
  return {
    predictedQualityScore: selected.reputation.avgQuality ?? 0.85,
    // ERC-8004's getSummary has no latency field, so avgLatencyMs is always
    // null today and this default is what the bond is actually staked against.
    // 500ms was an unvalidated guess that made EVERY organic stream slash on
    // latency: a real x402 call's latency includes the Circle Gateway payment
    // settlement round-trip, measured live at ~1.0-1.8s per call (never sub-
    // 500ms). 3000ms is a fair, evidence-based ceiling with headroom — still a
    // falsifiable bound a genuinely slow/degraded provider will breach.
    predictedLatencyMs: selected.reputation.avgLatencyMs ?? 3000,
    confidenceScore: hasHistory ? 0.9 : 0.6,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function routeTask(task: { taskDescription: string; category: string }): Promise<RoutingDecision> {
  const providers = await discoverProviders(task.category);
  const scored = await scoreProviders(providers);
  const selected = selectProvider(scored);
  const prediction = predictOutcome(selected);

  return { selectedProvider: selected, ...prediction };
}
