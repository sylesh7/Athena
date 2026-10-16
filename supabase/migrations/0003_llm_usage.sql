-- Every LLM call is recorded so the backend can enforce a hard spend cap (LLM_BUDGET_USD / LLM_DAILY_BUDGET_USD).
-- Costs are stored in micro-USD (1e-6 USD) as integers; never floats.
create table llm_usage (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  provider       text not null,
  model          text not null,
  purpose        text not null check (purpose in ('extract','plan')),
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cost_micro_usd bigint not null default 0,
  ok             boolean not null default true
);
create index llm_usage_at_idx on llm_usage(at);
alter table llm_usage enable row level security;
