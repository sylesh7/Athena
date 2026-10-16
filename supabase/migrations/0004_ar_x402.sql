-- Receivables: x402 pay links, settlement queue, and dunning log.

-- A receivable that accepts x402 (agent) payment is registered on-chain with customer = 0x0 so the collections wallet
-- can settle it with payReceivable(). Over-payment is still refused by the contract.
alter table receivables add column x402_enabled boolean not null default true;

-- One row per x402 payment received (credited to the collections wallet's Gateway balance, batched). Settlement withdraws
-- the credit to Arc and calls payReceivable() so the inflow names the receivable it pays for.
create table x402_receipts (
  id             bigserial primary key,
  receivable_id  text not null references receivables(receivable_id),
  amount         numeric(78,0) not null,
  payer          text,
  status         text not null default 'pending' check (status in ('pending','withdrawn','settled','failed')),
  withdraw_tx    text,
  settle_tx      text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index x402_receipts_status_idx on x402_receipts(status);

-- Every reminder email actually sent (or attempted), so stages are never repeated and the ladder is auditable.
create table receivable_reminders (
  id             bigserial primary key,
  receivable_id  text not null references receivables(receivable_id),
  stage          int not null,
  channel        text not null default 'email',
  ok             boolean not null,
  detail         text,
  sent_at        timestamptz not null default now(),
  unique (receivable_id, stage, channel)
);

alter table x402_receipts enable row level security;
alter table receivable_reminders enable row level security;
