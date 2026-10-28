-- READ ONLY. Inspect the target project BEFORE applying the one new upgrade file.
select version,name from supabase_migrations.schema_migrations order by version;
select to_regclass('public.online_competitions') as existing_competition,
       to_regclass('public.online_rounds') as existing_rounds,
       to_regclass('public.online_best_scores') as existing_legacy_scores,
       to_regclass('public.event_stages') as upgrade_already_present;
select tablename,rowsecurity from pg_tables
where schemaname='public' and (tablename like 'online_%' or tablename like 'event_%')
order by tablename;
