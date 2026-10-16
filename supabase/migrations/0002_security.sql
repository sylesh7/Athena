-- The frontend never talks to Postgres directly; it goes through the API.
-- RLS enabled with no policies => only the service role (server) can read or write.
alter table entities enable row level security;
alter table payees enable row level security;
alter table payee_address_history enable row level security;
alter table purchase_orders enable row level security;
alter table receipts enable row level security;
alter table documents enable row level security;
alter table invoices enable row level security;
alter table obligations enable row level security;
alter table subscriptions enable row level security;
alter table customers enable row level security;
alter table receivables enable row level security;
alter table cycles enable row level security;
alter table decisions enable row level security;
alter table escalations enable row level security;
alter table reviews enable row level security;
alter table used_nonces enable row level security;
alter table yield_positions enable row level security;
alter table cross_chain_transfers enable row level security;
alter table service_purchases enable row level security;
alter table screenings enable row level security;
alter table chain_events enable row level security;
alter table indexer_state enable row level security;
alter table unattributed_inflows enable row level security;
alter table metrics_snapshots enable row level security;

-- Private Storage bucket for invoice documents.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;
