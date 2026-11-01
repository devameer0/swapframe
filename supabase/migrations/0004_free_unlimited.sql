-- SwapFrame is free and unlimited: credits are no longer used (column kept, nullable, for optional future use).
alter table public.profiles alter column credits drop not null;
alter table public.profiles alter column credits set default null;
alter table public.profiles drop constraint if exists profiles_credits_check;
update public.profiles set credits = null;

-- Default site settings: monochrome palette + Figtree, unlimited swaps, 2–20s clips (free HF Space max is 20s).
-- Merges defaults under any existing values; only replaces the old lime/cyan palette. Safe to re-run.
update public.site_settings
set data = jsonb_build_object(
  'theme','dark','primary','#ffffff','accent','#a6a6a6','font','figtree',
  'daily_limit',0,'min_seconds',2,'max_seconds',20,'max_upload_mb',100,
  'signups_open',true,'maintenance_mode',false
) || (case when coalesce(data->>'primary','#b6ff3b') = '#b6ff3b'
           then data - 'theme' - 'primary' - 'accent' - 'font' - 'daily_limit' - 'min_seconds' - 'max_seconds'
           else data end),
updated_at = now()
where id = 1;
