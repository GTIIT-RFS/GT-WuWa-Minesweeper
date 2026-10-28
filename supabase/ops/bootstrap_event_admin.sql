-- MANUAL ONLY. First create a permanent, confirmed staff user with a strong password in Auth.
-- Replace the UUID below with that user's Auth UID. Never enter a password in this file.
do $$
declare staff uuid := 'REPLACE_WITH_STAFF_AUTH_UUID';
begin
  if not exists (select 1 from auth.users where id=staff and is_anonymous is false) then
    raise exception 'A pre-created non-anonymous Auth user is required';
  end if;
  insert into public.event_admins(user_id) values(staff) on conflict do nothing;
end;
$$;
-- To remove staff permission manually:
-- delete from public.event_admins where user_id='STAFF_AUTH_UUID';
