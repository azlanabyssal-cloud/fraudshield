-- FraudShield label store: blind double-labeling with Row-Level Security.
-- Plain PostgreSQL. Tested on PGlite (Postgres 18 compiled to WASM) in CI, runs unchanged on a real server.
--
-- Why a database at all: two annotators must label the same messages WITHOUT seeing each other's labels,
-- or inter-annotator agreement is meaningless. A CSV cannot enforce that; Row-Level Security can.
-- Identity is passed per session:  select set_config('app.who', 'azlan', false);  then  set role labeler;

create table annotators (
  id   text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  role text not null check (role in ('labeler', 'adjudicator'))
);

create function app_user() returns text language sql stable as
$$ select nullif(current_setting('app.who', true), '') $$;

-- Same normalisation as data_ops/holdout.js normalizeForDedup (a test keeps them identical).
create function normalize_for_dedup(t text) returns text language sql immutable as
$$ select btrim(regexp_replace(regexp_replace(regexp_replace(lower(t), '\[[^\]]*\]', '', 'g'), '\d+', '#', 'g'), '\s+', ' ', 'g')) $$;

-- Mirrors data_ops/holdout.js findPii. Returns the list of problems; empty means clean.
-- tests/db.test.js runs both implementations over one corpus and fails if they disagree.
create function pii_check(t text) returns text[] language plpgsql immutable as $$
declare
  problems text[] := '{}';
  m text[];
  suffixes text[] := array['ybl','ibl','axl','okicici','okhdfcbank','okaxis','oksbi','paytm','apl','upi',
    'sbi','hdfcbank','icici','axisbank','pnb','boi','cnrb','idfcbank','idfcfirst','kotak','ptsbi','pthdfc',
    'ptyes','yesbank','airtel','jio','postbank','fbl','rbl','aubank','federal','barodampay','freecharge',
    'ikwik','waicici','wahdfcbank','waaxis','wasbi','okbizaxis','abfspay','dbs','hsbc','sc','indus','uboi','allbank'];
  allowed text[] := array['PHONE','UPI','EMAIL','ACCOUNT','ID_NUMBER','PAN','HANDLE','NAME','ADDRESS','CARD','OTP'];
begin
  if t ~ '\d(?:[ -]?\d){8,}' then
    problems := array_append(problems, 'unmasked number');
  end if;
  for m in select regexp_matches(t, '([A-Za-z0-9._-]*)@([A-Za-z0-9.-]*)', 'g') loop
    if m[1] = '' and m[2] <> '' then
      problems := array_append(problems, 'handle @' || m[2]);
    elsif m[1] <> '' and (lower(m[2]) = any(suffixes) or m[1] ~ '[0-9._-]' or position('.' in m[2]) > 0) then
      problems := array_append(problems, 'upi id or email');
    end if;
  end loop;
  if t ~ '\m[A-Z]{5}[0-9]{4}[A-Z]\M' then
    problems := array_append(problems, 'pan');
  end if;
  for m in select regexp_matches(t, '\[([^\]]*)\]', 'g') loop
    if not (m[1] = any(allowed)) then
      problems := array_append(problems, 'unknown placeholder [' || m[1] || ']');
    end if;
  end loop;
  return problems;
end $$;

create table messages (
  id                   text primary key check (id ~ '^[A-Za-z0-9_-]+$'),
  raw_text_scrubbed    text not null check (length(btrim(raw_text_scrubbed)) >= 10),
  language_tag         text not null check (language_tag in ('en', 'hi', 'hinglish')),
  source_platform      text not null check (source_platform in
                         ('sms','whatsapp','telegram','email','social_media','advisory_quote','other')),
  sender_type          text not null default 'unknown' check (sender_type in
                         ('mobile_number','registered_header','unknown')),
  date_received        date not null check (date_received <= current_date),
  contains_obfuscation boolean not null,
  created_by           text not null references annotators(id),
  created_at           timestamptz not null default now(),
  -- A message with personal data cannot exist in this database at all.
  constraint messages_no_pii check (cardinality(pii_check(raw_text_scrubbed)) = 0),
  -- "@" is only allowed as an in-word character swap, which must be flagged as obfuscation.
  constraint messages_at_needs_obfuscation check (position('@' in raw_text_scrubbed) = 0 or contains_obfuscation)
);
-- Near-duplicate templates (same text modulo digits and placeholders) are rejected.
create unique index messages_dedup on messages (normalize_for_dedup(raw_text_scrubbed))
  where length(normalize_for_dedup(raw_text_scrubbed)) >= 10;

create table labels (
  message_id      text not null references messages(id),
  annotator_id    text not null references annotators(id),
  is_scam         boolean not null,
  attack_category text not null check (attack_category in
    ('upi_collect','digital_arrest','kyc_pan_block','job_fraud','electricity_disconnect','investment_scam',
     'loan_app','sextortion','sim_swap','other_scam','safe')),
  labeled_at      timestamptz not null default now(),
  primary key (message_id, annotator_id),
  check ((is_scam and attack_category <> 'safe') or (not is_scam and attack_category = 'safe'))
);

create table adjudications (
  message_id      text primary key references messages(id),
  adjudicator_id  text not null references annotators(id),
  is_scam         boolean not null,
  attack_category text not null,
  reason          text not null check (length(btrim(reason)) > 0),
  adjudicated_at  timestamptz not null default now(),
  check ((is_scam and attack_category <> 'safe') or (not is_scam and attack_category = 'safe'))
);

-- S0 = regression set (inspectable), S1 = sealed holdout. A message is in at most one.
create table splits (
  message_id  text primary key references messages(id),
  stage       text not null check (stage in ('s0', 's1')),
  assigned_at timestamptz not null default now()
);

do $$ begin
  if not exists (select from pg_roles where rolname = 'labeler')      then create role labeler nologin;      end if;
  if not exists (select from pg_roles where rolname = 'adjudicator')  then create role adjudicator nologin;  end if;
end $$;

alter table annotators    enable row level security; alter table annotators    force row level security;
alter table messages      enable row level security; alter table messages      force row level security;
alter table labels        enable row level security; alter table labels        force row level security;
alter table adjudications enable row level security; alter table adjudications force row level security;
alter table splits        enable row level security; alter table splits        force row level security;

grant usage on schema public to labeler, adjudicator;
grant select on annotators to labeler, adjudicator;
grant select, insert on messages to labeler;
grant select, insert, update on messages to adjudicator;
grant select, insert on labels to labeler;     -- no update or delete: a label, once given, stands
grant select on labels to adjudicator;
grant select, insert on adjudications to adjudicator;
grant select, insert on splits to adjudicator;

create policy annotators_read   on annotators for select to labeler, adjudicator using (true);
create policy messages_read     on messages   for select to labeler, adjudicator using (true);
create policy messages_add      on messages   for insert to labeler with check (created_by = app_user());
create policy messages_admin    on messages   for all    to adjudicator using (true) with check (true);
-- THE POINT OF THE DATABASE: a labeler sees and writes only their own labels.
create policy labels_own        on labels     for select to labeler using (annotator_id = app_user());
create policy labels_own_insert on labels     for insert to labeler with check (annotator_id = app_user());
create policy labels_review     on labels     for select to adjudicator using (true);
create policy adjud_all         on adjudications for all to adjudicator using (true) with check (adjudicator_id = app_user());
create policy splits_all        on splits     for all to adjudicator using (true) with check (true);

-- Cohen's kappa on is_scam between two annotators. Runs as the caller, so a labeler gets null (RLS hides the pairs).
create function cohen_kappa(a text, b text) returns numeric language sql stable as $$
  with p as (
    select la.is_scam as x, lb.is_scam as y
    from labels la join labels lb on la.message_id = lb.message_id
    where la.annotator_id = a and lb.annotator_id = b),
  s as (
    select count(*)::numeric n,
           count(*) filter (where x = y)::numeric agree,
           count(*) filter (where x)::numeric xa,
           count(*) filter (where y)::numeric yb from p),
  k as (
    select n, agree, (xa/n)*(yb/n) + ((n-xa)/n)*((n-yb)/n) as pe from s where n > 0)
  select case when pe = 1 then null else (agree/n - pe) / (1 - pe) end from k
$$;

-- The label that counts: an adjudication wins; otherwise two or more annotators who agree completely.
create view final_labels with (security_invoker = true) as
  select m.id,
         coalesce(a.is_scam, u.is_scam)                 as is_scam,
         coalesce(a.attack_category, u.attack_category) as attack_category,
         case when a.message_id is not null then 'adjudicated'
              when u.message_id is not null then 'unanimous'
              else 'pending' end                         as status
  from messages m
  left join adjudications a on a.message_id = m.id
  left join (
    select message_id, bool_and(is_scam) as is_scam, min(attack_category) as attack_category
    from labels group by message_id
    having count(*) >= 2 and count(distinct is_scam) = 1 and count(distinct attack_category) = 1
  ) u on u.message_id = m.id;

-- Messages two annotators disagree on and nobody has adjudicated yet.
create view needs_adjudication with (security_invoker = true) as
  select l.message_id
  from labels l left join adjudications a on a.message_id = l.message_id
  where a.message_id is null
  group by l.message_id
  having count(*) >= 2 and (count(distinct l.is_scam) > 1 or count(distinct l.attack_category) > 1);

-- Rows in the exact CSV shape data_ops/validate_csv.js expects, for one stage.
create function export_rows(p_stage text)
returns table (id text, raw_text_scrubbed text, language_tag text, is_scam text, attack_category text,
               source_platform text, date_received text, contains_obfuscation text)
language sql stable as $$
  select m.id, m.raw_text_scrubbed, m.language_tag, case when f.is_scam then '1' else '0' end,
         f.attack_category, m.source_platform, m.date_received::text, m.contains_obfuscation::text
  from messages m
  join splits s on s.message_id = m.id and s.stage = p_stage
  join final_labels f on f.id = m.id and f.status <> 'pending'
  order by m.id
$$;
