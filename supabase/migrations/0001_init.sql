-- Athena treasury schema. Amounts are numeric(78,0) atomic units (6 decimals).
-- Hashes and ids are lowercase 0x hex text. The chain is the source of truth for money;
-- this database is the source of truth for documents and plans, and a mirror of chain state.

-- ─── operated entity ────────────────────────────────────────────
create table entities (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  network           text not null check (network in ('testnet','mainnet')),
  treasury_address  text not null,
  timezone          text not null default 'UTC',
  created_at        timestamptz not null default now()
);

-- ─── vendor master ──────────────────────────────────────────────
create table payees (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references entities(id),
  slug               text not null,
  payee_id           text not null,              -- bytes32 on-chain id
  name               text not null,
  kind               text not null check (kind in ('vendor','contractor','service','internal')),
  category           text not null,              -- VENDOR | CONTRACTOR | SUBSCRIPTION | SERVICES | YIELD | FX
  token              text not null,
  domain             int  not null default 26,   -- CCTP domain; 26 = Arc
  account            text,
  remote_recipient   text,                       -- bytes32 mint recipient (other domains)
  email              text,
  status             text not null default 'draft'
                     check (status in ('draft','proposed','active','suspended','rejected')),
  active_from        timestamptz,
  per_tx_cap         numeric(78,0) not null default 0,
  risk_tier          text not null default 'unscreened'
                     check (risk_tier in ('unscreened','low','medium','high','blocked')),
  last_screened_at   timestamptz,
  erc8004_agent_id   numeric(78,0),
  scorecard          jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (entity_id, slug),
  unique (entity_id, payee_id)
);

create table payee_address_history (
  id                 bigserial primary key,
  payee_id           uuid not null references payees(id),
  old_account        text,
  new_account        text,
  old_remote         text,
  new_remote         text,
  source             text not null check (source in ('onboarding','invoice','manual')),
  source_document_id uuid,
  proposed_tx        text,
  approved_tx        text,
  status             text not null default 'proposed'
                     check (status in ('proposed','approved','rejected')),
  created_at         timestamptz not null default now()
);

-- ─── purchase orders and receipts (the other two legs of the match) ─
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id),
  payee_id      uuid not null references payees(id),
  po_number     text not null,
  token         text not null,
  total         numeric(78,0) not null,
  invoiced      numeric(78,0) not null default 0,
  terms         jsonb not null,   -- {"netDays":30,"discountBps":200,"discountDays":10}
  lines         jsonb not null,   -- [{"sku","description","qty","unitPrice"}] — unitPrice atomic units (string)
  status        text not null default 'open' check (status in ('open','closed','cancelled')),
  created_at    timestamptz not null default now(),
  unique (entity_id, po_number)
);

create table receipts (
  id             uuid primary key default gen_random_uuid(),
  po_id          uuid not null references purchase_orders(id),
  kind           text not null check (kind in ('delivery','milestone','usage')),
  lines          jsonb not null,
  evidence_uri   text,
  evidence_hash  text not null,   -- sha256 of the evidence artifact
  accepted_by    text not null,
  accepted_at    timestamptz not null default now()
);

-- ─── inbound documents and invoices ─────────────────────────────
create table documents (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id),
  source        text not null check (source in ('upload','email','api','seed')),
  filename      text,
  mime          text,
  storage_path  text not null,
  sha256        text not null,
  raw_text      text,
  received_at   timestamptz not null default now(),
  unique (entity_id, sha256)          -- the same file twice is a duplicate by definition
);

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references entities(id),
  document_id     uuid references documents(id),
  payee_id        uuid references payees(id),
  po_id           uuid references purchase_orders(id),
  invoice_number  text,
  invoice_date    date,
  due_date        date,
  token           text,
  total           numeric(78,0),
  lines           jsonb,
  terms           jsonb,
  extracted       jsonb not null,          -- raw model output, kept as a suggestion
  extraction_model text,
  printed_address text,                    -- payout address printed on the invoice (never used to pay)
  fingerprint     text,                    -- sha256(payee|number|total|token)
  duplicate_of    uuid references invoices(id),
  match_status    text not null default 'pending'
                  check (match_status in ('pending','matched','partial','mismatch','no_po')),
  match_detail    jsonb,
  status          text not null default 'received'
                  check (status in ('received','extracted','validated','held','rejected','obligated')),
  hold_reason     text,
  created_at      timestamptz not null default now()
);
create unique index invoices_fingerprint_uq on invoices(entity_id, fingerprint)
  where fingerprint is not null and duplicate_of is null;

-- ─── what is owed ───────────────────────────────────────────────
create table obligations (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references entities(id),
  obligation_id    text not null unique,     -- bytes32 on-chain id
  payee_id         uuid not null references payees(id),
  invoice_id       uuid references invoices(id),
  source           text not null check (source in ('invoice','subscription','milestone','manual')),
  category         text not null,
  token            text not null,
  amount           numeric(78,0) not null,
  due_date         date not null,
  terms            jsonb,
  criticality      int not null default 2,   -- 1 critical (contractors), 2 normal, 3 deferrable
  evidence_hash    text,                     -- sha256 of {invoice, po, receipt} bundle
  status           text not null default 'open'
                   check (status in ('open','scheduled','held','escalated','paid','cancelled')),
  planned_pay_date date,
  decision_id      text,
  paid_tx          text,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index obligations_open_idx on obligations(entity_id, status, due_date);

create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id),
  payee_id      uuid not null references payees(id),
  token         text not null,
  amount        numeric(78,0) not null,
  interval_days int not null,
  next_due      date not null,
  meter_key     text,                -- links to service usage for independent metering
  active        boolean not null default true
);

-- ─── what is owed to us ─────────────────────────────────────────
create table customers (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references entities(id),
  name             text not null,
  email            text,
  wallet           text,
  paid_count       int not null default 0,
  avg_days_late    numeric(10,2) not null default 0,
  risk_tier        text not null default 'unscreened',
  created_at       timestamptz not null default now()
);

create table receivables (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references entities(id),
  receivable_id    text not null unique,     -- bytes32 on-chain id
  customer_id      uuid not null references customers(id),
  invoice_number   text not null,
  token            text not null,
  amount_due       numeric(78,0) not null,
  amount_paid      numeric(78,0) not null default 0,
  issued_at        timestamptz not null default now(),
  due_date         date not null,
  status           text not null default 'open'
                   check (status in ('draft','open','partial','paid','written_off')),
  dunning_stage    int not null default 0,
  next_reminder_at timestamptz,
  register_tx      text,
  pdf_path         text
);

-- ─── decisions, the audit trail ─────────────────────────────────
create table cycles (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id),
  trigger       text not null,
  dry_run       boolean not null default false,
  status        text not null default 'running' check (status in ('running','done','failed','skipped')),
  snapshot      jsonb,
  snapshot_hash text,
  forecast      jsonb,
  forecast_hash text,
  policy_facts  jsonb,
  plan          jsonb,
  validation    jsonb,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table decisions (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references entities(id),
  cycle_id           uuid not null references cycles(id),
  decision_id        text not null unique,   -- bytes32 on-chain id
  seq                int not null,
  kind               text not null,          -- PAY_NOW | PAY_EARLY | SCHEDULE | HOLD | YIELD_DEPOSIT | YIELD_REDEEM | RESERVE | RELEASE_RESERVE | CONSOLIDATE | FX | TOP_UP_SERVICES
  obligation_id      text,
  action             jsonb,                  -- null for no-op decisions
  action_hash        text not null,
  record_json        text not null,          -- canonical JSON
  record_bytes       text not null,          -- 0x hex of the UTF-8 bytes
  decision_hash      text not null,          -- sha256
  planner_proposed   jsonb,
  planner_overruled  boolean not null default false,
  overrule_reason    text,
  state              text not null default 'recorded'
                     check (state in ('recorded','committed','executed','escalated','approved','rejected','cancelled','noop','failed')),
  revealed           boolean not null default false,
  commit_tx          text,
  execute_tx         text,
  reveal_tx          text,
  escalation_reason  int,
  follow_up          jsonb,                  -- yield deposit, CCTP mint, swap, consolidation status
  scenario           boolean not null default false, -- excluded from operating metrics
  created_at         timestamptz not null default now()
);
create index decisions_state_idx on decisions(entity_id, state, revealed);

create table escalations (
  decision_id     text primary key references decisions(decision_id),
  reason          int not null,
  expires_at      timestamptz not null,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','expired','cancelled')),
  notified_at     timestamptz,
  resolved_tx     text,
  resolved_by     text,
  resolved_at     timestamptz
);

create table reviews (
  id                bigserial primary key,
  decision_id       text not null references decisions(decision_id),
  reviewer_address  text not null,
  verdict           text not null check (verdict in ('agree','disagree')),
  note              text,
  signature         text not null,
  created_at        timestamptz not null default now(),
  unique (decision_id, reviewer_address)
);

-- Replay protection for EIP-191 signed API actions (review queue, decision reviews).
create table used_nonces (
  nonce       text primary key,
  address     text not null,
  used_at     timestamptz not null default now()
);

-- ─── money elsewhere ────────────────────────────────────────────
create table yield_positions (
  vault_address  text primary key,
  chain          text not null,
  name           text,
  principal      numeric(78,0) not null default 0,
  value          numeric(78,0) not null default 0,
  apy_bps        int,
  updated_at     timestamptz not null default now()
);

create table cross_chain_transfers (
  id               bigserial primary key,
  decision_id      text references decisions(decision_id),
  direction        text not null check (direction in ('cctp_out','gateway_in')),
  source_domain    int not null,
  destination_domain int not null,
  amount           numeric(78,0) not null,
  burn_tx          text,
  attestation      text,
  message          text,
  mint_tx          text,
  status           text not null default 'burned'
                   check (status in ('burned','attested','minted','failed')),
  updated_at       timestamptz not null default now()
);

create table service_purchases (
  id            bigserial primary key,
  decision_id   text,
  url           text not null,
  amount        numeric(78,0) not null,
  ok            boolean not null,
  latency_ms    int,
  meter_key     text,
  network       text not null default 'testnet',
  created_at    timestamptz not null default now()
);

create table screenings (
  id          bigserial primary key,
  address     text not null,
  chain       text not null,
  result      text not null,
  risk_tier   text not null,
  raw         jsonb not null,
  screened_at timestamptz not null default now()
);

-- ─── chain mirror ───────────────────────────────────────────────
create table chain_events (
  id           bigserial primary key,
  block_number bigint not null,
  tx_hash      text not null,
  log_index    int not null,
  event_name   text not null,
  args         jsonb not null,
  created_at   timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index chain_events_name_idx on chain_events(event_name, block_number);

create table indexer_state (
  contract     text primary key,
  last_block   bigint not null
);

create table unattributed_inflows (
  id          bigserial primary key,
  tx_hash     text not null,
  token       text not null,
  from_addr   text not null,
  amount      numeric(78,0) not null,
  resolved    boolean not null default false,
  note        text,
  unique (tx_hash, token, from_addr, amount)
);

-- ─── metrics ────────────────────────────────────────────────────
create table metrics_snapshots (
  id        bigserial primary key,
  taken_at  timestamptz not null default now(),
  network   text not null,
  data      jsonb not null
);
