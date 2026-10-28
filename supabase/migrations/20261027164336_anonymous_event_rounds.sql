-- Additive upgrade of the DEPLOYED phase-one schema. Never replay the initial migration.
begin;
alter table public.online_competitions add column event_date date;
alter table public.online_competitions add column paused boolean not null default false;

create table public.event_stages (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null references public.online_competitions(id),
  round_no smallint not null check (round_no between 1 and 4),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  prize_count integer not null default 3 check (prize_count between 0 and 20),
  settled_at timestamptz,
  unique (competition_id, round_no),
  check (ends_at = starts_at + interval '1 hour')
);
alter table public.online_rounds add column stage_id uuid references public.event_stages(id);
create index online_rounds_stage on public.online_rounds(stage_id);

-- Wins are immutable history. Legacy best scores are deliberately not imported into these tables.
create table public.event_wins (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references public.online_rounds(id),
  stage_id uuid not null references public.event_stages(id),
  player_id uuid not null,
  display_name text not null,
  elapsed_ms integer not null check (elapsed_ms >= 0 and elapsed_ms < 180000),
  achieved_at timestamptz not null
);
create index event_wins_stage_player on public.event_wins(stage_id,player_id,elapsed_ms,achieved_at,id);
create table public.event_bests (
  stage_id uuid not null references public.event_stages(id),
  player_id uuid not null,
  win_id uuid not null references public.event_wins(id),
  display_name text not null,
  elapsed_ms integer not null check (elapsed_ms >= 0 and elapsed_ms < 180000),
  achieved_at timestamptz not null,
  primary key (stage_id,player_id)
);
create index event_bests_ranking on public.event_bests(stage_id,elapsed_ms,achieved_at,player_id);
create table public.event_rankings (
  stage_id uuid not null references public.event_stages(id),
  player_id uuid not null,
  rank integer not null check (rank > 0),
  display_name text not null,
  elapsed_ms integer not null,
  achieved_at timestamptz not null,
  primary key (stage_id,player_id),
  unique (stage_id,rank)
);
create table public.event_awards (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null,
  player_id uuid not null,
  prize_slot integer not null check (prize_slot > 0),
  status text not null default 'pending' check (status in ('pending','unclaimed','claimed','waived','disqualified')),
  predecessor_id uuid references public.event_awards(id),
  created_at timestamptz not null,
  claimed_at timestamptz,
  foreign key (stage_id,player_id) references public.event_rankings(stage_id,player_id),
  unique (stage_id,player_id)
);
create unique index event_awards_active_slot on public.event_awards(stage_id,prize_slot) where status in ('pending','unclaimed','claimed');
create table public.event_credentials (
  award_id uuid primary key references public.event_awards(id),
  token text not null unique default (gen_random_uuid()::text || gen_random_uuid()::text)
);
create table public.event_claims (
  competition_id text not null references public.online_competitions(id),
  person_hash text not null,
  award_id uuid not null unique references public.event_awards(id),
  player_id uuid not null,
  primary key (competition_id,person_hash),
  unique (competition_id,player_id)
);
create table public.event_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.event_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  request_id uuid,
  operation_hash text,
  action text not null,
  stage_id uuid references public.event_stages(id),
  old_state jsonb,
  new_state jsonb,
  reason text,
  created_at timestamptz not null,
  result jsonb,
  unique (actor_id,request_id)
);
create index event_audit_created on public.event_audit(created_at desc,id desc);

-- Use one clock seam for deterministic local boundary tests. Production always uses DB time.
create function public.event_clock() returns timestamptz language sql volatile security invoker set search_path='' as $$select clock_timestamp()$$;
create function public.event_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'immutable history'; end;
$$;
create trigger event_wins_immutable before update or delete on public.event_wins for each row execute function public.event_immutable();
create trigger event_rankings_immutable before update or delete on public.event_rankings for each row execute function public.event_immutable();
create trigger event_audit_immutable before update or delete on public.event_audit for each row execute function public.event_immutable();

-- Service-only, SECURITY INVOKER throughout. No privileged function is callable by browsers.
create function public.event_require_admin(p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists (select 1 from public.event_admins a join auth.users u on u.id=a.user_id where a.user_id=p_actor and u.is_anonymous is false) then
    raise exception 'admin required' using errcode='42501';
  end if;
end;
$$;

create function public.event_round_response(p_round public.online_rounds) returns jsonb language sql volatile security invoker set search_path='' as $$
  select to_jsonb(p_round) || jsonb_build_object('server_now',public.event_clock(),'deadline',least(p_round.started_at+interval '180 seconds',s.ends_at))
  from public.event_stages s where s.id=p_round.stage_id
$$;
create function public.event_get_round(p_round uuid,p_player uuid) returns jsonb language sql volatile security invoker set search_path='' as $$
  select public.event_round_response(r) from public.online_rounds r where r.id=p_round and r.player_id=p_player and r.stage_id is not null
$$;

create or replace function public.start_online_round(p_player uuid,p_name text,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.online_rounds; s public.event_stages; e public.online_competitions; t timestamptz;
begin
  -- Every mutation takes this lock first: short DB transactions, no lock during network/engine work.
  select * into e from public.online_competitions where id='club-night-v1' for update;
  t:=public.event_clock();
  if not e.enabled or e.paused or e.event_date is null then raise exception 'event not open'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 16 or p_name ~ '[[:cntrl:]]' then raise exception 'invalid name'; end if;
  select * into s from public.event_stages where competition_id=e.id and starts_at<=t and t<ends_at and settled_at is null;
  if not found then raise exception 'event not open'; end if;
  select * into r from public.online_rounds where competition_id=e.id and player_id=p_player and finished_at is null;
  if found and r.stage_id=s.id and t<least(r.started_at+interval '180 seconds',s.ends_at) then return public.event_round_response(r); end if;
  if t>=s.ends_at-interval '180 seconds' then raise exception 'new games closed'; end if;
  update public.online_rounds set finished_at=t,state=jsonb_set(state,'{status}','"timeout"') where player_id=p_player and competition_id=e.id and finished_at is null;
  if exists(select 1 from public.online_rounds where player_id=p_player and started_at>t-interval '3 seconds') or
    (select count(*) from public.online_rounds where player_id=p_player and started_at>t-interval '1 hour')>=120 then raise exception 'start rate limit'; end if;
  insert into public.online_rounds(competition_id,player_id,display_name,state,started_at,stage_id)
    values(e.id,p_player,btrim(p_name),p_state,t,s.id) returning * into r;
  return public.event_round_response(r);
end;
$$;

create or replace function public.commit_online_move(p_round uuid,p_player uuid,p_revision integer,p_state jsonb,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.online_rounds; s public.event_stages; e public.online_competitions; t timestamptz; ms integer; next_state jsonb:=p_state; ended boolean; win uuid;
begin
  select * into e from public.online_competitions where id='club-night-v1' for update;
  select * into r from public.online_rounds where id=p_round and player_id=p_player for update;
  if not found or r.stage_id is null then raise exception 'round missing'; end if;
  select * into s from public.event_stages where id=r.stage_id;
  if r.last_request_id=p_request or r.finished_at is not null then return public.event_round_response(r); end if;
  if r.revision<>p_revision then raise exception 'revision conflict' using errcode='40001'; end if;
  t:=public.event_clock();
  ms:=greatest(0,floor(extract(epoch from (t-r.started_at))*1000))::integer;
  -- Left-closed, right-open windows. Old games can NEVER submit into the next stage.
  if ms>=180000 or t>=s.ends_at or t<s.starts_at or s.settled_at is not null then next_state:=jsonb_set(next_state,'{status}','"timeout"');
  elsif not e.enabled or e.paused then raise exception 'event paused'; end if;
  if r.revision>=4096 then next_state:=jsonb_set(next_state,'{status}','"timeout"'); end if;
  ended:=next_state->>'status' in ('won','lost','timeout');
  update public.online_rounds set state=next_state,revision=revision+1,last_request_id=p_request,finished_at=case when ended then t else null end where id=r.id returning * into r;
  if next_state->>'status'='won' then
    insert into public.event_wins(game_id,stage_id,player_id,display_name,elapsed_ms,achieved_at) values(r.id,s.id,p_player,r.display_name,ms,t) returning id into win;
    insert into public.event_bests(stage_id,player_id,win_id,display_name,elapsed_ms,achieved_at) values(s.id,p_player,win,r.display_name,ms,t)
      on conflict(stage_id,player_id) do update set win_id=excluded.win_id,display_name=excluded.display_name,elapsed_ms=excluded.elapsed_ms,achieved_at=excluded.achieved_at
      where excluded.elapsed_ms<public.event_bests.elapsed_ms;
  end if;
  return public.event_round_response(r);
end;
$$;

create function public.event_settle_due() returns integer language plpgsql security invoker set search_path='' as $$
declare s public.event_stages; t timestamptz; n integer:=0;
begin
  perform 1 from public.online_competitions where id='club-night-v1' for update;
  t:=public.event_clock();
  for s in select * from public.event_stages where competition_id='club-night-v1' and ends_at<=t and settled_at is null order by round_no loop
    -- Recompute from immutable wins, independently of mutable best-score caches and job lateness.
    insert into public.event_rankings(stage_id,player_id,rank,display_name,elapsed_ms,achieved_at)
      select s.id,b.player_id,row_number() over(order by b.elapsed_ms,b.achieved_at,b.player_id)::integer,b.display_name,b.elapsed_ms,b.achieved_at
      from (select distinct on(player_id) player_id,display_name,elapsed_ms,achieved_at from public.event_wins
        where stage_id=s.id and achieved_at>=s.starts_at and achieved_at<s.ends_at order by player_id,elapsed_ms,achieved_at,id) b;
    insert into public.event_awards(stage_id,player_id,prize_slot,created_at)
      select stage_id,player_id,rank,t from public.event_rankings where stage_id=s.id and rank<=s.prize_count;
    insert into public.event_credentials(award_id) select id from public.event_awards where stage_id=s.id;
    update public.event_stages set settled_at=t where id=s.id;
    insert into public.event_audit(action,stage_id,new_state,created_at) values('settle',s.id,jsonb_build_object('cutoff',s.ends_at,'prizeCount',s.prize_count),t);
    n:=n+1;
  end loop;
  return n;
end;
$$;

create function public.event_my_awards(p_player uuid) returns jsonb language sql security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('rank',r.rank,'display_name',r.display_name,'elapsed_ms',r.elapsed_ms,'round_no',s.round_no,'token',case when a.status in('pending','unclaimed') then c.token else null end) order by s.round_no),'[]')
  from public.event_awards a join public.event_rankings r using(stage_id,player_id) join public.event_stages s on s.id=a.stage_id join public.event_credentials c on c.award_id=a.id where a.player_id=p_player
$$;

create function public.event_board(p_kind text,p_stage uuid,p_player uuid,p_page integer default 0) returns jsonb language plpgsql security invoker set search_path='' as $$
declare entries jsonb; mine jsonb; total integer;
begin
  if p_page<0 or p_page>10000 or p_kind not in ('live','history','evening') then raise exception 'invalid board'; end if;
  if p_kind='history' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.rank),'[]') into entries from (select * from public.event_rankings where stage_id=p_stage order by rank limit 100 offset p_page*100) x;
    select to_jsonb(x) into mine from public.event_rankings x where stage_id=p_stage and player_id=p_player;
    select count(*) into total from public.event_rankings where stage_id=p_stage;
  else
    with best as (
      select distinct on(b.player_id) b.player_id,b.display_name,b.elapsed_ms,b.achieved_at
      from public.event_bests b join public.event_stages s on s.id=b.stage_id
      where (p_kind='evening' or b.stage_id=p_stage) and s.competition_id='club-night-v1'
      order by b.player_id,b.elapsed_ms,b.achieved_at,b.win_id
    ), ranked as(select *,row_number() over(order by elapsed_ms,achieved_at,player_id)::integer as rank from best)
    select coalesce((select jsonb_agg(to_jsonb(x) order by x.rank) from(select * from ranked order by rank limit case when p_kind='live' then 10 else 100 end offset p_page*100)x),'[]'),
      (select to_jsonb(x) from ranked x where player_id=p_player),(select count(*) from ranked) into entries,mine,total;
  end if;
  return jsonb_build_object('entries',entries,'mine',mine,'total',total);
end;
$$;
create function public.event_overview(p_player uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_competitions; s public.event_stages; t timestamptz; stages jsonb; awards jsonb; state text;
begin
  t:=public.event_clock(); select * into e from public.online_competitions where id='club-night-v1';
  select * into s from public.event_stages where competition_id=e.id and starts_at<=t and t<ends_at;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.round_no),'[]') into stages from public.event_stages x where competition_id=e.id;
  state:=case when e.event_date is null then 'unconfigured' when not e.enabled or e.paused then 'paused'
    when s.id is not null then case when t>=s.ends_at-interval '3 minutes' then 'closing' else 'open' end
    when t<(select min(starts_at) from public.event_stages where competition_id=e.id) then 'upcoming' else 'ended' end;
  select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('rank',r.rank,'display_name',r.display_name,'elapsed_ms',r.elapsed_ms,'round_no',x.round_no) order by x.round_no,a.prize_slot,a.created_at),'[]') into awards
    from public.event_awards a join public.event_rankings r using(stage_id,player_id) join public.event_stages x on x.id=a.stage_id;
  return jsonb_build_object('serverNow',t,'event',to_jsonb(e),'state',state,'stages',stages,'currentStage',case when s.id is null then null else to_jsonb(s) end,
    'live',public.event_board('live',s.id,p_player,0),'evening',public.event_board('evening',null,p_player,0),'awards',awards);
end;
$$;

create function public.event_admin_read(p_actor uuid,p_page integer default 0) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.event_require_admin(p_actor);
  if p_page<0 or p_page>10000 then raise exception 'invalid page'; end if;
  return jsonb_build_object('overview',public.event_overview(p_actor),
    'wins',coalesce((select jsonb_agg(to_jsonb(x) order by x.achieved_at desc,x.id) from (select * from public.event_wins order by achieved_at desc,id limit 100 offset p_page*100)x),'[]'),
    'audit',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from(select id,actor_id,action,stage_id,old_state,new_state,reason,created_at from public.event_audit order by id desc limit 100 offset p_page*100)x),'[]'));
end;
$$;

create function public.event_admin_action(p_actor uuid,p_request uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_competitions; s public.event_stages; a public.event_awards; previous public.event_audit;
  t timestamptz; d date; start_time timestamptz; end_time timestamptz; i integer; count_prizes integer;
  before_state jsonb; after_state jsonb; result jsonb:='{}'; stage uuid; candidate public.event_rankings; target_status text;
  digest text; person text; reason text; accepted integer; successor uuid;
begin
  perform public.event_require_admin(p_actor);
  if p_request is null then raise exception 'request id required'; end if;
  select * into e from public.online_competitions where id='club-night-v1' for update;
  t:=public.event_clock();
  digest:=encode(sha256(convert_to(p_action||coalesce(p_payload::text,''),'UTF8')),'hex');
  select * into previous from public.event_audit where actor_id=p_actor and request_id=p_request;
  if found then
    if previous.operation_hash<>digest then raise exception 'request reused' using errcode='40001'; end if;
    return previous.result||jsonb_build_object('replayed',true);
  end if;
  reason:=btrim(p_payload->>'reason');
  if p_action='configure' then
    d:=(p_payload->>'date')::date;
    if d is null or (d::timestamp+interval '18 hours') at time zone 'Asia/Shanghai'<=t then raise exception 'date must be future'; end if;
    if exists(select 1 from public.event_stages where starts_at<=t or settled_at is not null) then raise exception 'event already started'; end if;
    before_state:=to_jsonb(e);
    update public.online_competitions set event_date=d where id=e.id;
    for i in 1..4 loop
      start_time:=(d::timestamp+make_interval(hours=>17+i)) at time zone 'Asia/Shanghai';
      insert into public.event_stages(competition_id,round_no,starts_at,ends_at) values(e.id,i,start_time,start_time+interval '1 hour')
        on conflict(competition_id,round_no) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at;
    end loop;
    after_state:=jsonb_build_object('eventDate',d,'defaultSchedule',true);
  elsif p_action='pause' then
    before_state:=to_jsonb(e); update public.online_competitions set paused=(p_payload->>'paused')::boolean,enabled=true where id=e.id returning to_jsonb(online_competitions.*) into after_state;
  elsif p_action in('schedule','prizes') then
    stage:=(p_payload->>'stageId')::uuid; select * into s from public.event_stages where id=stage and competition_id=e.id;
    if not found or s.settled_at is not null or s.ends_at<=t then raise exception 'stage frozen or missing'; end if;
    before_state:=to_jsonb(s);
    if p_action='schedule' then
      if s.starts_at<=t or reason is null or length(reason)<2 then raise exception 'only future schedule with reason'; end if;
      start_time:=(p_payload->>'startsAt')::timestamptz; end_time:=(p_payload->>'endsAt')::timestamptz;
      if start_time is null or end_time is null or start_time<=t or end_time<>start_time+interval '1 hour' or
        exists(select 1 from public.event_stages where id<>stage and competition_id=e.id and (starts_at<end_time and ends_at>start_time or round_no<s.round_no and ends_at>start_time or round_no>s.round_no and starts_at<end_time)) or
        (start_time at time zone 'Asia/Shanghai')::date<>e.event_date then raise exception 'invalid schedule'; end if;
      update public.event_stages set starts_at=start_time,ends_at=end_time where id=stage;
    else
      count_prizes:=(p_payload->>'count')::integer;
      if count_prizes is null or count_prizes not between 0 and 20 then raise exception 'invalid prize count'; end if;
      update public.event_stages set prize_count=count_prizes where id=stage;
    end if;
    select to_jsonb(x) into after_state from public.event_stages x where id=stage;
  elsif p_action='settle' then
    accepted:=public.event_settle_due(); result:=jsonb_build_object('settledCount',accepted); after_state:=result;
  elsif p_action in('claim','status','rollover') then
    select * into a from public.event_awards where id=(p_payload->>'awardId')::uuid for update;
    if not found then raise exception 'award missing'; end if;
    stage:=a.stage_id; before_state:=to_jsonb(a);
    if p_action='claim' then
      if a.status not in('pending','unclaimed') then raise exception 'award already used or ineligible' using errcode='40001'; end if;
      if not exists(select 1 from public.event_credentials where award_id=a.id and token=p_payload->>'credential') then raise exception 'credential invalid' using errcode='42501'; end if;
      person:=lower(btrim(p_payload->>'participantRef'));
      if person is null or char_length(person) not between 1 and 64 or coalesce((p_payload->>'verifiedInPerson')::boolean,false) is false then raise exception 'onsite verification required'; end if;
      person:=encode(sha256(convert_to(person,'UTF8')),'hex');
      if exists(select 1 from public.event_claims where competition_id=e.id and (person_hash=person or player_id=a.player_id)) then raise exception 'person already claimed' using errcode='40001'; end if;
      insert into public.event_claims values(e.id,person,a.id,a.player_id);
      update public.event_awards set status='claimed',claimed_at=t where id=a.id;
    elsif p_action='status' then
      target_status:=p_payload->>'status';
      if reason is null or length(reason)<2 or target_status is null or target_status not in('unclaimed','waived','disqualified') then raise exception 'reason and valid status required'; end if;
      if a.status='claimed' and target_status<>'disqualified' then raise exception 'claimed award cannot reopen'; end if;
      if a.status in('waived','disqualified') then raise exception 'award frozen'; end if;
      update public.event_awards set status=target_status where id=a.id;
      -- A disqualified claimed award keeps the claim registry, preventing an extra gift.
    else
      if a.status not in('waived','disqualified') or reason is null or length(reason)<2 then raise exception 'rollover requires cancellation and reason'; end if;
      if exists(select 1 from public.event_awards where predecessor_id=a.id) then raise exception 'already rolled over' using errcode='40001'; end if;
      select * into candidate from public.event_rankings r where r.stage_id=stage
        and not exists(select 1 from public.event_awards x where x.stage_id=stage and x.player_id=r.player_id)
        and not exists(select 1 from public.event_claims c where c.competition_id=e.id and c.player_id=r.player_id)
        order by r.rank limit 1;
      if not found then raise exception 'no eligible successor'; end if;
      insert into public.event_awards(stage_id,player_id,prize_slot,predecessor_id,created_at) values(stage,candidate.player_id,a.prize_slot,a.id,t) returning id into successor;
      insert into public.event_credentials(award_id) values(successor);
      result:=jsonb_build_object('successorAwardId',successor);
    end if;
    select to_jsonb(x) into after_state from public.event_awards x where id=a.id;
    if p_action='rollover' then
      after_state:=jsonb_build_object('originalAward',after_state,'successor',(select to_jsonb(x) from public.event_awards x where id=successor));
    end if;
  else raise exception 'unknown admin action'; end if;
  result:=result||jsonb_build_object('ok',true);
  insert into public.event_audit(actor_id,request_id,operation_hash,action,stage_id,old_state,new_state,reason,created_at,result)
    values(p_actor,p_request,digest,p_action,stage,before_state,after_state,reason,t,result);
  return result;
end;
$$;

-- Public projections contain no credentials, raw verification codes or admin-only records.
do $$
declare tbl text; fn record;
begin
  foreach tbl in array array['event_stages','event_wins','event_bests','event_rankings','event_awards','event_credentials','event_claims','event_admins','event_audit'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant all on public.%I to service_role',tbl);
  end loop;
  foreach tbl in array array['event_stages','event_bests','event_rankings','event_awards'] loop
    execute format('grant select on public.%I to anon,authenticated',tbl);
    execute format('create policy "Public event projection" on public.%I for select to anon,authenticated using(true)',tbl);
  end loop;
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'event\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end;
$$;
revoke all on sequence public.event_audit_id_seq from public,anon,authenticated;
grant usage,select on sequence public.event_audit_id_seq to service_role;
-- Lock down original private rounds again, including anonymous users' authenticated role.
revoke all on public.online_rounds from public,anon,authenticated;
commit;
