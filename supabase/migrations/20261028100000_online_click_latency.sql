begin;

-- The hot start path searches for an unfinished round by player and competition.
-- Keep this partial index small; finished historical rounds do not participate.
create index if not exists online_rounds_active_player_competition_idx
  on public.online_rounds (player_id, competition_id, started_at desc)
  where finished_at is null;

commit;
