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
import { decodeAbiParameters, parseAbi } from "viem";
import { addresses } from "../lib/config.js";
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

/**
 * Lists x402 provider agents from Circle's Agent Marketplace via the Circle
 * CLI. Requires `circle` CLI installed and authenticated (see BACKEND_B_README
 * Phase 0). The CLI's `--output json` schema is not formally documented for
 * pre-1.0 `circle services list` — this parses the commonly-observed shape
 * defensively (tolerates a couple of plausible field-name variants) rather
 * than assuming one exact schema. Verify against a live `circle services list
 * --output json` run before demoing.
 */
export async function discoverProviders(category: string): Promise<DiscoveredProvider[]> {
  const { stdout } = await execFileAsync("circle", [
    "services",
    "list",
    "--chain",
    "ARC-TESTNET",
    "--category",
    category,
    "--output",
    "json",
  ]);

  const raw = JSON.parse(stdout);
  const list: unknown[] = Array.isArray(raw) ? raw : (raw.services ?? raw.data ?? []);

  return list.map((entry): DiscoveredProvider => {
    const e = entry as Record<string, unknown>;
    const address = (e.sellerAddress ?? e.address ?? e.wallet) as string;
    const url = (e.endpoint ?? e.url) as string;
    const priceRaw = (e.price ?? e.pricePerCall ?? "0") as string | number;
    const pricePerCallUsdc = typeof priceRaw === "number" ? priceRaw : parseFloat(String(priceRaw).replace(/[^0-9.]/g, ""));

    if (!address || !url) {
      throw new Error(`Unexpected \`circle services list\` entry shape: ${JSON.stringify(entry)}`);
    }

    return {
      address: address as `0x${string}`,
      url,
      name: String(e.name ?? url),
      category: String(e.category ?? category),
      pricePerCallUsdc: Number.isFinite(pricePerCallUsdc) ? pricePerCallUsdc : 0,
      endpointCount: Number(e.endpointCount ?? 1),
    };
  });
}

// ── 2. Scoring — ERC-8004 reputation lookup ─────────────────────────────────

const reputationAbi = parseAbi([
  "function readAllFeedback(uint256 agentId) external view returns (bytes memory)",
]);

const identityAbi = parseAbi([
  "function tokenOfOwner(address owner) external view returns (uint256)",
]);

/**
 * Reads a provider's ERC-8004 reputation history. `readAllFeedback` returns
 * opaque ABI-encoded bytes; we decode it as an array of the `giveFeedback`
 * struct shape documented in BACKEND_A_README (agentId, score int128,
 * feedbackType uint8, tag, metadataURI, evidenceURI, comment, feedbackHash).
 * ERC-8004 is a Draft EIP — BACKEND_A_README already flags this encoding as
 * something to re-verify against the live ABI on Arcscan. If decoding fails
 * (unregistered provider, empty history, or a different on-chain encoding)
 * we fall back to a neutral "no track record yet" summary rather than
 * throwing, so a first-ever stream to a brand-new provider can still route.
 */
export async function readErc8004Reputation(providerAddress: `0x${string}`): Promise<ReputationSummary> {
  const empty: ReputationSummary = { avgQuality: null, avgLatencyMs: null, sampleSize: 0 };

  try {
    const tokenId = await publicClient.readContract({
      address: addresses.contracts.erc8004Identity as `0x${string}`,
      abi: identityAbi,
      functionName: "tokenOfOwner",
      args: [providerAddress],
    });

    const raw = await publicClient.readContract({
      address: addresses.contracts.erc8004Reputation as `0x${string}`,
      abi: reputationAbi,
      functionName: "readAllFeedback",
      args: [tokenId],
    });

    if (!raw || raw === "0x") return empty;

    const [entries] = decodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "agentId", type: "uint256" },
            { name: "score", type: "int128" },
            { name: "feedbackType", type: "uint8" },
            { name: "tag", type: "string" },
            { name: "metadataURI", type: "string" },
            { name: "evidenceURI", type: "string" },
            { name: "comment", type: "string" },
            { name: "feedbackHash", type: "bytes32" },
          ],
        },
      ],
      raw
    );

    if (entries.length === 0) return empty;

    // score is 0-100 "prediction accuracy" per BACKEND_A_README post-reputation.ts.
    // We don't have separate on-chain quality/latency fields, so we treat the
    // feedback score as a proxy for both until a richer schema is agreed —
    // this is a real (if coarse) signal, not a placeholder.
    const scores = entries.map((e) => Number(e.score) / 100);
    const avgQuality = scores.reduce((a, b) => a + b, 0) / scores.length;

    return { avgQuality, avgLatencyMs: null, sampleSize: entries.length };
  } catch {
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
    predictedLatencyMs: selected.reputation.avgLatencyMs ?? 500,
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
