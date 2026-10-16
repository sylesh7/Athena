-- Crash-safe Gateway withdrawals. The SDK's withdraw() is burn-then-mint with the attestation held only in memory: if the mint
-- transaction cannot be broadcast, the Gateway balance is already reduced and the attestation is gone (observed live on Arc
-- testnet, ~0.5 USDC lost). We persist the signed attestation BEFORE minting, so the mint can always be retried — gatewayMint
-- may be called by anyone, so even another operator could finish it.
create table gateway_transfers (
  id            bigserial primary key,
  wallet        text not null,                  -- depositor (collections wallet) whose Gateway balance was burned
  recipient     text not null,
  amount        numeric(78,0) not null,
  purpose       text not null,                  -- 'consolidate' | 'x402_settle' | 'other'
  attestation   text not null,
  signature     text not null,
  status        text not null default 'attested' check (status in ('attested','minted','failed')),
  mint_tx       text,
  attempts      int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index gateway_transfers_status_idx on gateway_transfers(status);
alter table gateway_transfers enable row level security;
