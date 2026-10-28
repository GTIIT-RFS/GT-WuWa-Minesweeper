-- Reduce contention between unrelated players without weakening event-boundary serialization.
-- The event row remains share-locked while a start/move commits. Administrative updates and
-- settlement take an exclusive row lock, so they still wait for in-flight operations.
begin;

do $migration$
declare
  v text;
  anchor text;
begin
  select pg_get_functiondef('public.start_online_round(uuid,text,jsonb)'::regprocedure) into v;
  anchor := $$select * into e from public.online_competitions where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$;
  if position(anchor in v)=0 then raise exception 'start_online_round lock anchor missing'; end if;
  v := replace(v, anchor,
    $$perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_player::text,0));
  select * into e from public.online_competitions where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for share;$$);
  v := replace(v, 'Every mutation takes this lock first: short DB transactions, no lock during network/engine work.',
    'Starts serialize per player; a shared event lock protects schedule state while allowing different players to start concurrently.');
  execute v;

  select pg_get_functiondef('public.commit_online_move(uuid,uuid,integer,jsonb,uuid)'::regprocedure) into v;
  anchor := $$select * into e from public.online_competitions where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for update;$$;
  if position(anchor in v)=0 then raise exception 'commit_online_move lock anchor missing'; end if;
  v := replace(v, anchor,
    $$select * into e from public.online_competitions where id=coalesce(nullif(current_setting('app.competition_id',true),''),'club-night-v1') for share;$$);
  execute v;
end;
$migration$;

commit;
