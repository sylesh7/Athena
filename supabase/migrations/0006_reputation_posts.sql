-- One ERC-8004 feedback post per subject per UTC day (idempotent, auditable).
create table reputation_posts (
  day      date not null,
  subject  text not null,           -- 'operator' (Athena itself) | later: vendor slugs
  score    int not null,
  tx       text,
  posted_at timestamptz not null default now(),
  primary key (day, subject)
);
alter table reputation_posts enable row level security;
