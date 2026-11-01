# SwapFrame

Recast any short clip: upload a video and a character image, and SwapFrame returns the same video with the person replaced by your character, keeping the same motion, camera and background. **Free and unlimited:** no credits and no daily cap.

**Live:** https://devameer0.github.io/swapframe/ · **Admin app:** https://github.com/devameer0/swapframe-admin

- Frontend: Vite + vanilla JS with a monochrome look (black, greys and white, Figtree font, drifting grey orbs, 20px cards). Deployed to GitHub Pages from the `gh-pages` branch with `npm run deploy`.
- Auth, storage, database: [Supabase](https://supabase.com) (email/password, private buckets, `jobs` and `profiles` tables with RLS).
- AI (free): the public Hugging Face Space [`alexnasa/Wan2.2-Animate-ZEROGPU`](https://huggingface.co/spaces/alexnasa/Wan2.2-Animate-ZEROGPU) running Wan 2.2 Animate. It uses the Gradio endpoint `/animate_scene` in "Character Swap" mode.
- Optional paid fallback: Replicate [`wan-video/wan-2.2-animate-replace`](https://replicate.com/wan-video/wan-2.2-animate-replace). This is only used if you set `REPLICATE_API_TOKEN` as a Supabase function secret. That token never goes into the frontend.

## Free Space caveats (please read)
- Free ZeroGPU Spaces **queue, rate-limit and enforce a per-visitor daily GPU quota**. A 2s clip needs about 110s of GPU time and a 20s clip about 500s. Medium Res doubles that. Signed-out or anonymous Hugging Face visitors get a small quota, so jobs can fail with a quota or "error" message. Try again later or use a shorter clip.
- The Space caps clips at **20 seconds**, so SwapFrame accepts clips of 2–20s.
- The Space is a community Space. Its owner can change it, put it to sleep or remove it at any time. If it breaks, set `REPLICATE_API_TOKEN` to enable the paid fallback, or point `HF_SPACE_HOST` in `supabase/functions/swap/index.ts` at another Wan 2.2 Animate Space.
- How it runs: the `swap` edge function checks ban and maintenance status, records the job and signs the input URLs. Your **browser** then calls the Space directly, so the job uses your own IP and HF quota, because an edge function can't hold a multi-minute Gradio stream. When the Space finishes, the function downloads the result (it only accepts URLs on the Space's host) into the private `results` bucket.
- `HF_TOKEN` is optional and **not used** by the browser path. Leave it unset.

## Safety built in
- Sign-in required. A consent checkbox ("I own or have permission to use this video and image, and won't impersonate or deceive") is enforced in the UI and by a database check.
- Results are labelled **AI-generated**.
- Limits: video MP4/MOV/WebM, 2–20 seconds, ≤100 MB; image PNG/JPG/WebP, ≤10 MB. These are checked in the browser and by the bucket limits. Admins can change them.
- Ban and maintenance mode are enforced server-side.

## Setup
1. Create a Supabase project.
2. In the SQL Editor, run **`supabase/all_migrations.sql`**. It contains every migration (0001 to 0005) in order and is safe to re-run. It creates the tables, RLS, the private `uploads` and `results` buckets, storage policies, `site_settings` defaults and the function grants.
3. Deploy the functions: `supabase functions deploy swap` and `supabase functions deploy admin`.
4. Optional: `supabase secrets set REPLICATE_API_TOKEN=r8_...` to enable the paid fallback.
5. Go to *Auth → URL Configuration*. Set Site URL to `https://devameer0.github.io/swapframe/` and add `https://devameer0.github.io/swapframe-admin/` to the Redirect URLs.
6. Put your project URL and publishable (or anon) key in `public/config.js`. These are public by design.

## Admin dashboard (separate app)
The admin dashboard is its own repo, https://github.com/devameer0/swapframe-admin (live at https://devameer0.github.io/swapframe-admin/). It uses the same Supabase project. Its SQL and the `admin` function live in this repo.

**Make the first admin.** Sign up on the main site, confirm the email, then run:
```sql
update public.profiles set role='admin' where email='iahmadabubakar0@gmail.com';
```

Admins can edit users (name, role, ban), delete jobs or users, and edit site settings: theme, colors, font, limits, an optional daily cap (0 = unlimited, the default), sign-ups, maintenance mode, the announcement and page content. `profiles.credits` is no longer used.

## Local dev
```bash
npm install
npm run dev
npm run build
npm run deploy   # builds and pushes dist/ to gh-pages
```

## Cost
- Hugging Face Space: free, subject to queue and quota.
- Supabase: the free tier is enough to start.
- Replicate fallback (only if enabled): $0.02/s of output at 480p or $0.05/s at 720p, per the model page (checked Nov 1, 2026).

## License
MIT. Use responsibly and only with media you have rights to.
