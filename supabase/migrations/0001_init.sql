-- SwapFrame schema: jobs table + private storage buckets, all protected by RLS.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'queued' check (status in ('queued','starting','processing','succeeded','failed','canceled')),
  video_path text not null,
  image_path text not null,
  output_path text,
  prediction_id text,
  error text,
  consent boolean not null default false check (consent = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_user_idx on public.jobs(user_id, created_at desc);
alter table public.jobs enable row level security;

drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs for select using (auth.uid() = user_id);
drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs for insert with check (auth.uid() = user_id);
drop policy if exists "jobs_delete_own" on public.jobs;
create policy "jobs_delete_own" on public.jobs for delete using (auth.uid() = user_id);
-- No update policy for users: status/output are written only by the edge function (service role).

-- Buckets (private). Files live under "<user_id>/..." so policies can check ownership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
 ('uploads','uploads', false, 104857600, array['video/mp4','video/quicktime','video/webm','image/png','image/jpeg','image/webp']),
 ('results','results', false, 524288000, array['video/mp4'])
on conflict (id) do nothing;

drop policy if exists "uploads_rw_own" on storage.objects;
create policy "uploads_rw_own" on storage.objects for all
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "results_read_own" on storage.objects;
create policy "results_read_own" on storage.objects for select
  using (bucket_id = 'results' and (storage.foldername(name))[1] = auth.uid()::text);
