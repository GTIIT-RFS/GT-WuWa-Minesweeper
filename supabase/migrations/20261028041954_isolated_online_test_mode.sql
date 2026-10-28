
begin;

-- Official rounds remain exactly one hour; isolated test stages may stay open.
alter table public.event_stages drop constraint event_stages_check;
alter table public.event_stages
  add constraint event_stages_duration_check
  check (ends_at = starts_at + interval '1 hour' or competition_id like 'club-night-test-%');

create table public.event_test_control (
  singleton boolean primary key default true check (singleton),
  active_competition_id text not null references public.online_competitions(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.event_test_control enable row level security;
revoke all on public.event_test_control from public, anon, authenticated;
grant all on public.event_test_control to service_role;

-- Existing RPCs default to the official event. Test wrappers set a transaction-local scope.
do $migration$
declare v text;
begin
  select pg_get_functiondef('public.start_online_round(uuid,text,jsonb)'::regprocedure) into v;
  if position($$where id='club-night-v1' for update;$$ in v)=0 then raise exception 'start_online_round patch anchor missing'; end if;
  v:=replace(v,$$where id='club-night-v1' for update;$$,$$where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$);
  execute v;

  select pg_get_functiondef('public.commit_online_move(uuid,uuid,integer,jsonb,uuid)'::regprocedure) into v;
  if position($$where id='club-night-v1' for update;$$ in v)=0 then raise exception 'commit_online_move patch anchor missing'; end if;
  v:=replace(v,$$where id='club-night-v1' for update;$$,$$where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$);
  execute v;

  select pg_get_functiondef('public.event_settle_due()'::regprocedure) into v;
  if position($$where id='club-night-v1' for update;$$ in v)=0 then raise exception 'event_settle_due lock anchor missing'; end if;
  v:=replace(v,$$where id='club-night-v1' for update;$$,$$where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$);
  if position($$where competition_id='club-night-v1' and ends_at<=t and settled_at is null order by round_no loop$$ in v)=0 then raise exception 'event_settle_due loop anchor missing'; end if;
  v:=replace(v,
    $$where competition_id='club-night-v1' and ends_at<=t and settled_at is null order by round_no loop$$,
    $$where competition_id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1')
      and (ends_at<=t or (coalesce(current_setting('app.force_test_settle',true),'false')='true' and competition_id like 'club-night-test-%'))
      and settled_at is null order by round_no loop$$);
  execute v;

  select pg_get_functiondef('public.event_board(text,uuid,uuid,integer)'::regprocedure) into v;
  if position($$declare entries jsonb; mine jsonb; total integer;$$ in v)=0 then raise exception 'event_board declaration anchor missing'; end if;
  v:=replace(v,$$declare entries jsonb; mine jsonb; total integer;$$,
    $$declare entries jsonb; mine jsonb; total integer; scope text:=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1');$$);
  if position($$if p_kind='history' then$$ in v)=0 then raise exception 'event_board history anchor missing'; end if;
  v:=replace(v,$$if p_kind='history' then$$,
    $$if p_kind='history' and not exists(
    select 1 from public.event_stages z where z.id=p_stage and
      ((scope='club-night-v1' and z.competition_id='club-night-v1') or
       (scope like 'club-night-test-%' and z.competition_id like 'club-night-test-%'))
  ) then raise exception 'invalid stage'; end if;
  if p_kind='history' then$$);
  if position($$and s.competition_id='club-night-v1'$$ in v)=0 then raise exception 'event_board competition anchor missing'; end if;
  v:=replace(v,$$and s.competition_id='club-night-v1'$$,
    $$and ((scope='club-night-v1' and s.competition_id='club-night-v1') or
      (scope like 'club-night-test-%' and s.competition_id like 'club-night-test-%'))$$);
  execute v;

  select pg_get_functiondef('public.event_overview(uuid)'::regprocedure) into v;
  if position($$where id='club-night-v1';$$ in v)=0 then raise exception 'event_overview event anchor missing'; end if;
  v:=replace(v,$$where id='club-night-v1';$$,$$where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1');$$);
  if position($$where competition_id=e.id;$$ in v)=0 then raise exception 'event_overview stages anchor missing'; end if;
  v:=replace(v,$$where competition_id=e.id;$$,
    $$where (e.id like 'club-night-test-%' and x.competition_id like 'club-night-test-%') or x.competition_id=e.id;$$);
  if position($$from public.event_awards a join public.event_rankings r using(stage_id,player_id) join public.event_stages x on x.id=a.stage_id;$$ in v)=0 then raise exception 'event_overview awards anchor missing'; end if;
  v:=replace(v,
    $$from public.event_awards a join public.event_rankings r using(stage_id,player_id) join public.event_stages x on x.id=a.stage_id;$$,
    $$from public.event_awards a join public.event_rankings r using(stage_id,player_id) join public.event_stages x on x.id=a.stage_id
    where (e.id like 'club-night-test-%' and x.competition_id like 'club-night-test-%') or x.competition_id=e.id;$$);
  v:=replace(v,$$order by x.round_no),'[]') into stages$$,$$order by x.round_no,x.starts_at),'[]') into stages$$);
  execute v;

  select pg_get_functiondef('public.event_my_awards(uuid)'::regprocedure) into v;
  if position($$where a.player_id=p_player$$ in v)=0 then raise exception 'event_my_awards anchor missing'; end if;
  v:=replace(v,$$where a.player_id=p_player$$,
    $$where a.player_id=p_player and (
      (coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1')='club-night-v1' and s.competition_id='club-night-v1')
      or (coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') like 'club-night-test-%' and s.competition_id like 'club-night-test-%')
    )$$);
  execute v;

  select pg_get_functiondef('public.event_admin_read(uuid,integer)'::regprocedure) into v;
  if position($$from public.event_wins order by achieved_at desc,id limit 100 offset p_page*100$$ in v)=0 then raise exception 'event_admin_read wins anchor missing'; end if;
  v:=replace(v,$$from public.event_wins order by achieved_at desc,id limit 100 offset p_page*100$$,
    $$from public.event_wins where stage_id in (select id from public.event_stages where competition_id='club-night-v1') order by achieved_at desc,id limit 100 offset p_page*100$$);
  if position($$from public.event_audit order by id desc limit 100 offset p_page*100$$ in v)=0 then raise exception 'event_admin_read audit anchor missing'; end if;
  v:=replace(v,$$from public.event_audit order by id desc limit 100 offset p_page*100$$,
    $$from public.event_audit where (stage_id in (select id from public.event_stages where competition_id='club-night-v1') or (stage_id is null and action<>'test_settle')) order by id desc limit 100 offset p_page*100$$);
  execute v;

  select pg_get_functiondef('public.event_admin_action(uuid,uuid,text,jsonb)'::regprocedure) into v;
  if position($$where id='club-night-v1' for update;$$ in v)=0 then raise exception 'event_admin_action event anchor missing'; end if;
  v:=replace(v,$$where id='club-night-v1' for update;$$,$$where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$);
  if position($$where starts_at<=t or settled_at is not null$$ in v)=0 then raise exception 'event_admin_action configure anchor missing'; end if;
  v:=replace(v,$$where starts_at<=t or settled_at is not null$$,$$where competition_id=e.id and (starts_at<=t or settled_at is not null)$$);
  if position($$if not found then raise exception 'award missing'; end if;
    stage:=a.stage_id; before_state:=to_jsonb(a);$$ in v)=0 then raise exception 'event_admin_action award anchor missing'; end if;
  v:=replace(v,$$if not found then raise exception 'award missing'; end if;
    stage:=a.stage_id; before_state:=to_jsonb(a);$$,
    $$if not found then raise exception 'award missing'; end if;
    if not exists(select 1 from public.event_stages where id=a.stage_id and competition_id=e.id) then
      raise exception 'award belongs to another competition' using errcode='42501';
    end if;
    stage:=a.stage_id; before_state:=to_jsonb(a);$$);
  execute v;
end;
$migration$;

-- Seed a persistent test series. New test series are created automatically after test settlement.
insert into public.online_competitions(id,title,enabled,event_date,paused)
values ('club-night-test-initial','GT WuWa 在线测试场（不计入正式赛）',true,
  (public.event_clock() at time zone 'Asia/Shanghai')::date,false)
on conflict (id) do nothing;

insert into public.event_stages(competition_id,round_no,starts_at,ends_at,prize_count)
values ('club-night-test-initial',1,public.event_clock()-interval '1 second',
  public.event_clock()+interval '10 years',3)
on conflict (competition_id,round_no) do nothing;

insert into public.event_test_control(singleton,active_competition_id)
values (true,'club-night-test-initial')
on conflict (singleton) do nothing;

create or replace function public.event_test_ensure_open()
returns text language plpgsql security invoker set search_path='' as $$
declare active text; s public.event_stages; t timestamptz;
begin
  perform 1 from public.event_test_control where singleton=true for update;
  select active_competition_id into active from public.event_test_control where singleton=true;
  t:=public.event_clock();
  if active is not null then
    select * into s from public.event_stages where competition_id=active order by round_no desc limit 1;
  end if;
  if active is null or s.id is null or s.settled_at is not null or s.ends_at<=t then
    if active is not null and s.id is not null and s.settled_at is null and s.ends_at<=t then
      perform set_config('app.competition_id',active,true);
      perform public.event_settle_due();
    end if;
    active:='club-night-test-'||replace(gen_random_uuid()::text,'-','');
    insert into public.online_competitions(id,title,enabled,event_date,paused)
      values(active,'GT WuWa 在线测试场（不计入正式赛）',true,(t at time zone 'Asia/Shanghai')::date,false);
    insert into public.event_stages(competition_id,round_no,starts_at,ends_at,prize_count)
      values(active,1,t-interval '1 second',t+interval '10 years',3);
    update public.event_test_control set active_competition_id=active,updated_at=t where singleton=true;
  end if;
  return active;
end;
$$;

create or replace function public.event_test_overview(p_player uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text;
begin
  active:=public.event_test_ensure_open();
  perform set_config('app.competition_id',active,true);
  return public.event_overview(p_player);
end;
$$;

create or replace function public.event_test_board(p_kind text,p_stage uuid,p_player uuid,p_page integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text;
begin
  active:=public.event_test_ensure_open();
  perform set_config('app.competition_id',active,true);
  return public.event_board(p_kind,p_stage,p_player,p_page);
end;
$$;

create or replace function public.event_test_awards(p_player uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text;
begin
  active:=public.event_test_ensure_open();
  perform set_config('app.competition_id',active,true);
  return public.event_my_awards(p_player);
end;
$$;

create or replace function public.event_test_start(p_player uuid,p_name text,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text;
begin
  active:=public.event_test_ensure_open();
  perform set_config('app.competition_id',active,true);
  return public.start_online_round(p_player,p_name,p_state);
end;
$$;

create or replace function public.event_test_commit(p_round uuid,p_player uuid,p_revision integer,p_state jsonb,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text; r public.online_rounds;
begin
  select * into r from public.online_rounds
    where id=p_round and player_id=p_player and competition_id like 'club-night-test-%';
  if not found then raise exception 'round missing'; end if;
  active:=r.competition_id;
  perform set_config('app.competition_id',active,true);
  return public.commit_online_move(p_round,p_player,p_revision,p_state,p_request);
end;
$$;

create or replace function public.event_test_admin_settle(p_actor uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text; next_active text; stage uuid; previous public.event_audit; t timestamptz; accepted integer; result jsonb;
begin
  perform public.event_require_admin(p_actor);
  if p_request is null then raise exception 'request id required'; end if;
  select * into previous from public.event_audit where actor_id=p_actor and request_id=p_request;
  if found then
    if previous.action<>'test_settle' then raise exception 'request reused' using errcode='40001'; end if;
    return previous.result||jsonb_build_object('replayed',true);
  end if;
  active:=public.event_test_ensure_open();
  select id into stage from public.event_stages where competition_id=active and settled_at is null order by round_no desc limit 1;
  if stage is null then raise exception 'test stage missing'; end if;
  t:=public.event_clock();
  perform set_config('app.competition_id',active,true);
  perform set_config('app.force_test_settle','true',true);
  accepted:=public.event_settle_due();
  perform set_config('app.force_test_settle','false',true);
  next_active:=public.event_test_ensure_open();
  result:=jsonb_build_object('ok',true,'settledCount',accepted,'settledCompetitionId',active,'nextCompetitionId',next_active);
  insert into public.event_audit(actor_id,request_id,operation_hash,action,stage_id,new_state,reason,created_at,result)
    values(p_actor,p_request,encode(sha256(convert_to('test_settle','UTF8')),'hex'),'test_settle',stage,
      jsonb_build_object('settledCount',accepted,'nextCompetitionId',next_active),
      'test-only manual settlement',t,result);
  return result;
end;
$$;

create or replace function public.event_test_admin_action(p_actor uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare comp text; award uuid;
begin
  perform public.event_require_admin(p_actor);
  if p_action not in ('claim','status','rollover') then raise exception 'invalid test action'; end if;
  award:=(p_payload->>'awardId')::uuid;
  select s.competition_id into comp
    from public.event_awards a join public.event_stages s on s.id=a.stage_id
    where a.id=award and s.competition_id like 'club-night-test-%';
  if comp is null then raise exception 'test award missing' using errcode='42501'; end if;
  perform set_config('app.competition_id',comp,true);
  return public.event_admin_action(p_actor,p_request,p_action,p_payload);
end;
$$;

-- Direct public table reads remain limited to the formal competition.
drop policy if exists "Public event projection" on public.event_stages;
create policy "Public event projection" on public.event_stages
  for select to anon,authenticated using (competition_id='club-night-v1');
drop policy if exists "Public event projection" on public.event_bests;
create policy "Public event projection" on public.event_bests
  for select to anon,authenticated using (
    exists(select 1 from public.event_stages s where s.id=event_bests.stage_id and s.competition_id='club-night-v1')
  );
drop policy if exists "Public event projection" on public.event_rankings;
create policy "Public event projection" on public.event_rankings
  for select to anon,authenticated using (
    exists(select 1 from public.event_stages s where s.id=event_rankings.stage_id and s.competition_id='club-night-v1')
  );
drop policy if exists "Public event projection" on public.event_awards;
create policy "Public event projection" on public.event_awards
  for select to anon,authenticated using (
    exists(select 1 from public.event_stages s where s.id=event_awards.stage_id and s.competition_id='club-night-v1')
  );

revoke all on function public.event_test_ensure_open() from public,anon,authenticated;
revoke all on function public.event_test_overview(uuid) from public,anon,authenticated;
revoke all on function public.event_test_board(text,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.event_test_awards(uuid) from public,anon,authenticated;
revoke all on function public.event_test_start(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.event_test_commit(uuid,uuid,integer,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.event_test_admin_settle(uuid,uuid) from public,anon,authenticated;
revoke all on function public.event_test_admin_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.event_test_ensure_open() to service_role;
grant execute on function public.event_test_overview(uuid) to service_role;
grant execute on function public.event_test_board(text,uuid,uuid,integer) to service_role;
grant execute on function public.event_test_awards(uuid) to service_role;
grant execute on function public.event_test_start(uuid,text,jsonb) to service_role;
grant execute on function public.event_test_commit(uuid,uuid,integer,jsonb,uuid) to service_role;
grant execute on function public.event_test_admin_settle(uuid,uuid) to service_role;
grant execute on function public.event_test_admin_action(uuid,uuid,text,jsonb) to service_role;

commit;
