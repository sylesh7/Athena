import { z } from "zod";
import { isAddress, isHex } from "viem";

const pk = z.string().refine((v) => isHex(v) && v.length === 66, "must be a 0x-prefixed 32-byte hex key");
const addr = z.string().refine((v) => isAddress(v), "must be an address");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

/** Env shared by every process. Process-specific secrets are parsed separately so the API never needs operator keys. */
const Common = z.object({
  NETWORK: z.enum(["testnet", "mainnet"]),
  RPC_URL: z.string().url(),
  RPC_URL_FALLBACK: z.string().url(),
  TREASURY_ADDRESS: addr,
  TREASURY_DEPLOY_BLOCK: z.coerce.bigint(),
  ADMIN_ADDRESS: addr,
  APPROVER_ADDRESS: addr,
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  DATABASE_URL: z.string(),
  REVEAL_DEADLINE_BLOCKS: z.coerce.bigint().default(7200n),
  LOG_LEVEL: z.string().default("info"),
});

const WorkerOnly = z.object({
  OPERATOR_PK: pk,
  KEEPER_PK: pk.optional(),
  YIELD_PK: pk.optional(),
  SPEND_PK: pk.optional(),
  COLLECTIONS_PK: pk.optional(),
  VALIDATOR_PK: pk.optional(),
  RELAYER_PK: pk.optional(),
  CIRCLE_API_KEY: z.string().min(10).optional(),
  CIRCLE_ENTITY_SECRET: z.string().min(10).optional(),
  FX_WALLET_ID: z.string().optional(),
  FX_WALLET_ADDRESS: addr.optional(),
  APP_KIT_API_KEY: z.string().optional(),
  // AI is optional: without a key the worker runs the deterministic default plan and skips invoice extraction.
  // Either provider works; LLM_PROVIDER forces one, otherwise whichever key is present (Anthropic first).
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PLANNER_MODEL: z.string().default("none"),
  EXTRACTOR_MODEL: z.string().optional(),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  OPERATOR_ENABLED: bool.default("true"),
  DRY_RUN: bool.default("false"),
  SKIP_REVEAL: bool.default("false"), // scenario S13 only
  CYCLE_CRON: z.string().default("*/15 * * * *"),
  FORECAST_HORIZON_DAYS: z.coerce.number().int().min(7).max(90).default(30),
  STRESS_INFLOW_DELAY_DAYS: z.coerce.number().int().default(7),
  STRESS_RECEIVABLE_HAIRCUT_BPS: z.coerce.bigint().default(5000n),
  YIELD_MIN_SWEEP_UNITS: z.coerce.bigint().default(5_000_000n),
  YIELD_HORIZON_DAYS: z.coerce.number().int().default(14),
  EARLY_PAY_MARGIN_BPS: z.coerce.bigint().default(200n),
  FX_MAX_DEVIATION_BPS: z.coerce.bigint().default(50n),
});

const ApiOnly = z.object({
  API_PORT: z.coerce.number().default(3100),
  ADMIN_API_KEY: z.string().min(24),
  CORS_ORIGIN: z.string(),
  PUBLIC_BASE_URL: z.string().url(),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
});

// Blank values (KEY=) in .env.local mean "not set", not "set to an empty string" — otherwise optional address/key
// fields fail validation just because the template left them empty.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));

export const commonCfg = Common.parse(cleanEnv());
export const loadWorkerCfg = () => WorkerOnly.parse(cleanEnv());
export const loadApiCfg = () => ApiOnly.parse(cleanEnv());

export type CommonCfg = typeof commonCfg;
export type WorkerCfg = z.infer<typeof WorkerOnly>;
export type ApiCfg = z.infer<typeof ApiOnly>;
