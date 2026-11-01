# SwapFrame

Recast any short clip: upload a video and a character image, and SwapFrame returns the same video with the person replaced by your character — same motion, camera and background.

**Live:** https://devameer0.github.io/swapframe/

- Frontend: Vite + vanilla JS, deployed to GitHub Pages from the `gh-pages` branch (`npm run deploy`).
- Auth, storage, database: [Supabase](https://supabase.com) (email/password, private buckets, `jobs` table with RLS).
- AI: Supabase Edge Function `swap` → Replicate model [`wan-video/wan-2.2-animate-replace`](https://replicate.com/wan-video/wan-2.2-animate-replace) (inputs: `video`, `character_image`, `resolution`, `merge_audio`, `go_fast`, …).
- Your Replicate token only ever lives as a Supabase function secret. It is never in the frontend.

Without a backend configured, the site still loads and shows the full UI with a "backend not configured yet" notice.

## Safety built in
- Required consent checkbox: *"I own or have permission to use this video and character; no real person's likeness without consent."* (also enforced in the DB: `consent = true`).
- Results are labeled **AI-generated**.
- Limits: video MP4/MOV/WebM, 10–30 seconds, ≤100 MB; image PNG/JPG/WebP, ≤10 MB (checked in browser and by bucket limits).
- Users only ever see their own jobs and files (RLS on `jobs` and `storage.objects`).

## Setup (about 15 minutes)

1. **Create a Supabase project** at https://supabase.com/dashboard (free tier works).
2. **Run the SQL.** Open *SQL Editor*, paste `supabase/migrations/0001_init.sql`, click *Run*. This creates the `jobs` table, RLS policies, and the private `uploads` and `results` buckets. (Check *Storage* to confirm both buckets exist; if not, create them as private buckets with those names.)
3. **Auth settings.** *Authentication → URL Configuration*: set Site URL to `https://devameer0.github.io/swapframe/`. Email/password sign-up is on by default (turn off "Confirm email" if you want instant sign-in).
4. **Get a Replicate token** at https://replicate.com/account/api-tokens.
5. **Deploy the edge function** (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set REPLICATE_API_TOKEN=r8_xxxxxxxx
   supabase functions deploy swap
   ```
6. **Point the site at your project.** In *Project Settings → API* copy the Project URL and the `anon` public key, then edit `public/config.js`:
   ```js
   window.SWAPFRAME_CONFIG = { SUPABASE_URL: "https://xxxx.supabase.co", SUPABASE_ANON_KEY: "eyJ..." };
   ```
   The anon key is safe to publish (RLS protects data). Never put the Replicate token here.
7. **Redeploy:** commit to `main`, then run `npm install && npm run deploy` — it builds and pushes `dist/` to the `gh-pages` branch that Pages serves (live in ~1 minute).

## Local dev
```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # outputs dist/
```

## How a job flows
1. Browser uploads the video and image to `uploads/<user_id>/…` and inserts a `jobs` row.
2. Browser calls the `swap` function with `{action:"start"}` → function signs the upload URLs and creates a Replicate prediction, storing its id.
3. Browser polls `{action:"status"}` every few seconds → when Replicate finishes, the function copies the output into `results/<user_id>/<job>.mp4` and marks the job `succeeded`.
4. The dashboard plays it from a short-lived signed URL with a Download button; History lists past jobs.

## Rough cost
From the [model page's pricing](https://replicate.com/wan-video/wan-2.2-animate-replace) (checked Nov 1, 2026), billed per second of output video:
- 480p: **$0.02 / second** of output → about $0.20–$0.60 for a 10–30s clip
- 720p: **$0.05 / second** of output → about $0.50–$1.50 for a 10–30s clip

Prices can change; check the model page. Supabase's free tier covers light usage.

## License
MIT
