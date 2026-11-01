// SwapFrame edge function.
// POST {action:"start", job_id}  -> creates a Replicate prediction for the job
// POST {action:"status", job_id} -> polls Replicate, saves output to the results bucket when done
// Secrets: REPLICATE_API_TOKEN (set with `supabase secrets set`). SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "wan-video/wan-2.2-animate-replace"; // https://replicate.com/wan-video/wan-2.2-animate-replace
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = Deno.env.get("REPLICATE_API_TOKEN");
    if (!token) return json({ error: "REPLICATE_API_TOKEN secret is not set" }, 500);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { action, job_id, resolution } = await req.json();
    const { data: job } = await admin.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single();
    if (!job) return json({ error: "Job not found" }, 404);

    if (action === "start") {
      if (job.prediction_id) return json({ job });
      const { data: prof } = await admin.from("profiles").select("banned,credits,usage_count").eq("id", user.id).single();
      if (!prof || prof.banned) {
        await admin.from("jobs").update({ status: "failed", error: "Account banned", updated_at: new Date() }).eq("id", job.id);
        return json({ error: "Your account is banned" }, 403);
      }
      const { data: st } = await admin.from("site_settings").select("data").eq("id", 1).single();
      const settings = st?.data ?? {};
      const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (settings.maintenance_mode && me?.role !== "admin") {
        await admin.from("jobs").update({ status: "failed", error: "Maintenance mode", updated_at: new Date() }).eq("id", job.id);
        return json({ error: "SwapFrame is in maintenance mode. Try again later." }, 503);
      }
      const daily = Number(settings.daily_limit ?? 3);
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("prediction_id", "is", null).gte("created_at", since.toISOString());
      if (daily > 0 && (count ?? 0) >= daily && me?.role !== "admin") {
        await admin.from("jobs").update({ status: "failed", error: "Daily limit reached", updated_at: new Date() }).eq("id", job.id);
        return json({ error: `Daily limit of ${daily} swaps reached. Come back tomorrow.` }, 429);
      }
      if (prof.credits <= 0) {
        await admin.from("jobs").update({ status: "failed", error: "No credits left", updated_at: new Date() }).eq("id", job.id);
        return json({ error: "No credits left. Ask the admin for more." }, 402);
      }
      const sign = async (p: string) =>
        (await admin.storage.from("uploads").createSignedUrl(p, 60 * 60 * 2)).data?.signedUrl;
      const [video, character_image] = await Promise.all([sign(job.video_path), sign(job.image_path)]);
      if (!video || !character_image) return json({ error: "Could not sign upload URLs" }, 500);
      const r = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { video, character_image, resolution: resolution === "480" ? "480" : "720", merge_audio: true, go_fast: true },
        }),
      });
      const p = await r.json();
      if (!r.ok) {
        await admin.from("jobs").update({ status: "failed", error: p.detail ?? "Replicate error", updated_at: new Date() }).eq("id", job.id);
        return json({ error: p.detail ?? "Replicate error" }, 502);
      }
      await admin.from("profiles").update({ credits: prof.credits - 1, usage_count: prof.usage_count + 1 }).eq("id", user.id);
      const { data } = await admin.from("jobs")
        .update({ prediction_id: p.id, status: p.status ?? "starting", updated_at: new Date() })
        .eq("id", job.id).select().single();
      return json({ job: data });
    }

    if (action === "status") {
      if (!job.prediction_id || ["succeeded", "failed", "canceled"].includes(job.status)) return json({ job });
      const r = await fetch(`https://api.replicate.com/v1/predictions/${job.prediction_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const p = await r.json();
      const patch: Record<string, unknown> = { status: p.status, updated_at: new Date() };
      if (p.status === "succeeded") {
        const outUrl = Array.isArray(p.output) ? p.output[0] : p.output;
        const bytes = new Uint8Array(await (await fetch(outUrl)).arrayBuffer());
        const path = `${user.id}/${job.id}.mp4`;
        const up = await admin.storage.from("results").upload(path, bytes, { contentType: "video/mp4", upsert: true });
        if (up.error) { patch.status = "failed"; patch.error = up.error.message; } else patch.output_path = path;
      } else if (p.status === "failed" || p.status === "canceled") {
        patch.error = p.error ?? p.status;
      }
      const { data } = await admin.from("jobs").update(patch).eq("id", job.id).select().single();
      return json({ job: data });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
