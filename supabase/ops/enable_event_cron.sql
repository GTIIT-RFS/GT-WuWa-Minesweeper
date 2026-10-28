-- MANUAL OPT-IN ONLY. Run after administrator authorization, upgrade and pg_cron enablement.
-- No secret keys, network requests or paid scheduler required. One idempotent job every minute.
-- The DB deadline is enforced even if this job is delayed or disabled.
select cron.schedule(
  'gt-wuwa-settle-rounds',
  '* * * * *',
  $$select public.event_settle_due();$$
);
-- Verify via Dashboard Cron or: select jobid,jobname,schedule,active from cron.job;
-- To disable manually: select cron.unschedule('gt-wuwa-settle-rounds');
