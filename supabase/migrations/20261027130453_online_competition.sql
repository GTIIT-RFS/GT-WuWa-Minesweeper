-- Phase 1: fixed-rule, server-authoritative competition. No browser score writes.
begin;

create table public.online_competitions (
  id text primary key,
  title text not null,
  enabled boolean not null default true
);
insert into public.online_competitions (id, title) values ('club-night-v1', 'GT WuWa 社团之夜');

create table public.online_rounds (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null references public.online_competitions(id),
  player_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 16),
  state jsonb not null check (
    state->'config' = '{"rows":8,"cols":8,"mines":10}'::jsonb and
    state->>'status' in ('ready','playing','won','lost','timeout') and
    jsonb_array_length(state->'cells') = 64
  ),
  revision integer not null default 0 check (revision >= 0),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  last_request_id uuid
);
create unique index online_one_active_round on public.online_rounds (competition_id, player_id) where finished_at is null;
create index online_rounds_player_started on public.online_rounds (player_id, started_at desc);

create table public.online_best_scores (
  competition_id text not null references public.online_competitions(id),
  player_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 16),
  elapsed_ms integer not null check (elapsed_ms >= 0 and elapsed_ms < 180000),
  achieved_at timestamptz not null,
  primary key (competition_id, player_id)
);
create index online_best_scores_ranking on public.online_best_scores (competition_id, elapsed_ms, achieved_at, player_id);

alter table public.online_competitions enable row level security;
alter table public.online_rounds enable row level security;
alter table public.online_best_scores enable row level security;
revoke all on public.online_competitions, public.online_rounds, public.online_best_scores from public, anon, authenticated;
grant select on public.online_competitions, public.online_best_scores to anon, authenticated;
create policy "Public competition info" on public.online_competitions for select to anon, authenticated using (true);
create policy "Public verified best scores" on public.online_best_scores for select to anon, authenticated using (true);
-- No client policy or privilege on round state: hidden mines must remain private.
grant all on public.online_competitions, public.online_rounds, public.online_best_scores to service_role;

-- These functions run with caller rights, are service-only, and are never SECURITY DEFINER.
create function public.start_online_round(p_player uuid, p_name text, p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.online_rounds;
  t timestamptz;
begin
  -- Serialize starts by player, including simultaneous devices and retries.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_player::text, 0));
  t := clock_timestamp();
  if not exists (select 1 from public.online_competitions where id='club-night-v1' and enabled) then
    raise exception 'competition closed';
  end if;
  if char_length(btrim(p_name)) not between 1 and 16 then raise exception 'invalid name'; end if;
  select * into r from public.online_rounds where player_id=p_player and competition_id='club-night-v1' and finished_at is null;
  if found and r.started_at + interval '180 seconds' > t then return to_jsonb(r); end if;
  update public.online_rounds set finished_at=t, state=jsonb_set(state,'{status}','"timeout"')
    where player_id=p_player and competition_id='club-night-v1' and finished_at is null;
  if exists (select 1 from public.online_rounds where player_id=p_player and started_at > t-interval '3 seconds')
     or (select count(*) from public.online_rounds where player_id=p_player and started_at > t-interval '1 hour') >= 120 then
    raise exception 'start rate limit';
  end if;
  insert into public.online_rounds (competition_id,player_id,display_name,state,started_at)
    values ('club-night-v1',p_player,btrim(p_name),p_state,t) returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.commit_online_move(p_round uuid, p_player uuid, p_revision integer, p_state jsonb, p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.online_rounds;
  t timestamptz;
  ms integer;
  next_state jsonb := p_state;
  ended boolean;
begin
  select * into r from public.online_rounds where id=p_round and player_id=p_player for update;
  if not found then raise exception 'round missing'; end if;
  if r.last_request_id=p_request or r.finished_at is not null then return to_jsonb(r); end if;
  if r.revision<>p_revision then raise exception 'revision conflict' using errcode='40001'; end if;
  if not exists (select 1 from public.online_competitions where id=r.competition_id and enabled) then
    raise exception 'competition closed';
  end if;
  t := clock_timestamp();
  ms := greatest(0, floor(extract(epoch from (t-r.started_at))*1000))::integer;
  -- The database deadline wins over a stale Edge worker clock or an in-flight request.
  if ms>=180000 then next_state := jsonb_set(next_state,'{status}','"timeout"'); end if;
  ended := next_state->>'status' in ('won','lost','timeout');
  update public.online_rounds set state=next_state, revision=revision+1,
    last_request_id=p_request, finished_at=case when ended then t else null end
    where id=r.id returning * into r;
  if next_state->>'status'='won' and exists (select 1 from public.online_competitions where id=r.competition_id and enabled) then
    insert into public.online_best_scores (competition_id,player_id,display_name,elapsed_ms,achieved_at)
      values (r.competition_id,r.player_id,r.display_name,ms,t)
      on conflict (competition_id,player_id) do update
        set display_name=excluded.display_name, elapsed_ms=excluded.elapsed_ms, achieved_at=excluded.achieved_at
        where excluded.elapsed_ms < public.online_best_scores.elapsed_ms;
  end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.start_online_round(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.commit_online_move(uuid,uuid,integer,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.start_online_round(uuid,text,jsonb) to service_role;
grant execute on function public.commit_online_move(uuid,uuid,integer,jsonb,uuid) to service_role;
commit;
