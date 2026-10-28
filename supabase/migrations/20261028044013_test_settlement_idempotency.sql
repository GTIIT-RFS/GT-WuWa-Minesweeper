create or replace function public.event_test_admin_settle(p_actor uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active text; next_active text; stage uuid; previous public.event_audit; t timestamptz; accepted integer; result jsonb;
begin
  perform public.event_require_admin(p_actor);
  if p_request is null then raise exception 'request id required'; end if;

  -- Serialize settlements before checking the idempotency key, so a retry cannot settle the next round.
  perform 1 from public.event_test_control where singleton=true for update;
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
