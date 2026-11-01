// SwapFrame `swap` edge function.
//
// Free path (default): HF Space black-forest-labs/FLUX.2-klein-4B (/infer, multi-reference full character swap),
// with linoyts/Flux2-Klein-Face-Swap (/face_swap) as automatic fallback.
//   PHOTO mode: the browser holds the Gradio queue stream (ZeroGPU quota is per visitor) and this function does the trusted parts:
//   POST {action:"start", job_id}                -> checks ban/maintenance, returns short-lived signed input URLs
//   POST {action:"complete", job_id, output_url} -> downloads the Space's output (hf.space only) into `results`
//   POST {action:"fail", job_id, error}          -> marks the job failed
// Optional paid fallback (only if the REPLICATE_API_TOKEN secret is set):
//   POST {action:"start", job_id, provider:"replicate"} -> Replicate wan-video/wan-2.2-animate-replace
//   POST {action:"status", job_id}                      -> polls Replicate and saves the output
import { createClient } from "npm:@supabase/supabase-js@2";

const HF_SPACE_HOST = "black-forest-labs-flux-2-klein-4b.hf.space"; // full character swap (multi-reference edit)
const HF_FALLBACK_HOST = "linoyts-flux2-klein-face-swap.hf.space"; // face-swap fallback
const HF_HOSTS = [HF_SPACE_HOST, HF_FALLBACK_HOST];
const REPLICATE_MODEL = "wan-video/wan-2.2-animate-replace";
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
    const url = Deno.env.get("SUPABASE_URL")!;
    const replicateToken = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { action, job_id, provider, output_url, error: clientError } = await req.json();
    const { data: job } = await admin.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single();
    if (!job) return json({ error: "Job not found" }, 404);
    const patch = (p: Record<string, unknown>) =>
      admin.from("jobs").update({ ...p, updated_at: new Date().toISOString() }).eq("id", job.id).select().single();
    const fail = async (msg: string, code: number) => { await patch({ status: "failed", error: msg }); return json({ error: msg }, code); };

    const saveOutput = async (src: string) => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Could not download output (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Output too large");
      let ct = (res.headers.get("content-type") ?? "").split(";")[0];
      const ext = /\.png($|\?)/i.test(src) || ct === "image/png" ? "png" : /\.jpe?g($|\?)/i.test(src) || ct === "image/jpeg" ? "jpg" : /\.mp4($|\?)/i.test(src) ? "mp4" : "webp";
      ct = { png: "image/png", jpg: "image/jpeg", mp4: "video/mp4", webp: "image/webp" }[ext]!;
      const path = `${user.id}/${job.id}.${ext}`;
      const up = await admin.storage.from("results").upload(path, bytes, { contentType: ct, upsert: true });
      if (up.error) throw new Error(up.error.message);
      return path;
    };

    if (action === "start") {
      if (["succeeded", "failed", "canceled"].includes(job.status)) return json({ job });
      const { data: prof } = await admin.from("profiles").select("banned,role,usage_count").eq("id", user.id).single();
      if (!prof || prof.banned) return fail("Your account is banned", 403);
      const { data: st } = await admin.from("site_settings").select("data").eq("id", 1).single();
      const settings = st?.data ?? {};
      if (settings.maintenance_mode && prof.role !== "admin") return fail("SwapFrame is in maintenance mode. Try again later.", 503);
      // Optional daily cap, disabled by default (0 = unlimited; SwapFrame is free for everyone).
      const daily = Number(settings.daily_limit ?? 0);
      if (daily > 0 && prof.role !== "admin") {
        const since = new Date(); since.setUTCHours(0, 0, 0, 0);
        const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).not("prediction_id", "is", null).gte("created_at", since.toISOString());
        if ((count ?? 0) >= daily) return fail(`Daily limit of ${daily} swaps reached. Come back tomorrow.`, 429);
      }
      const sign = async (p: string) => (await admin.storage.from("uploads").createSignedUrl(p, 60 * 60 * 2)).data?.signedUrl;
      const [video, character_image] = await Promise.all([sign(job.source_path ?? job.video_path), sign(job.image_path)]);
      if (!video || !character_image) return fail("Could not sign upload URLs", 500);
      await admin.from("profiles").update({ usage_count: (prof.usage_count ?? 0) + 1 }).eq("id", user.id);

      if (provider === "replicate") {
        if (!replicateToken) return json({ error: "Replicate fallback is not enabled" }, 400);
        const r = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: { video, character_image, resolution: "480", merge_audio: true, go_fast: true } }),
        });
        const p = await r.json();
        if (!r.ok) return fail(p.detail ?? "Replicate error", 502);
        const { data } = await patch({ prediction_id: `replicate:${p.id}`, status: "processing", error: null });
        return json({ job: data, provider: "replicate" });
      }
      const { data } = await patch({ prediction_id: "hf", status: "processing", error: null });
      return json({ job: data, provider: "hf", space: `https://${HF_SPACE_HOST}`, api_name: "infer", fallback_space: `https://${HF_FALLBACK_HOST}`, photo_url: video, video_url: video, image_url: character_image,
        replicate_available: !!replicateToken });
    }

    if (action === "complete") {
      if (job.status === "succeeded") return json({ job });
      let u: URL;
      try { u = new URL(String(output_url)); } catch { return json({ error: "Bad output URL" }, 400); }
      if (u.protocol !== "https:" || !HF_HOSTS.includes(u.hostname)) return json({ error: "Output must come from the SwapFrame HF Space" }, 400);
      try {
        const path = await saveOutput(u.toString());
        const { data } = await patch({ status: "succeeded", output_path: path, error: null });
        return json({ job: data });
      } catch (e) { return fail(String((e as Error).message), 502); }
    }

    if (action === "fail") {
      if (job.status === "succeeded") return json({ job });
      const { data } = await patch({ status: "failed", error: String(clientError ?? "Generation failed").slice(0, 500) });
      return json({ job: data, replicate_available: !!replicateToken });
    }

    if (action === "status") {
      const pid = String(job.prediction_id ?? "");
      if (!pid.startsWith("replicate:") || ["succeeded", "failed", "canceled"].includes(job.status)) return json({ job });
      const r = await fetch(`https://api.replicate.com/v1/predictions/${pid.slice(10)}`, { headers: { Authorization: `Bearer ${replicateToken}` } });
      const p = await r.json();
      if (p.status === "succeeded") {
        try {
          const path = await saveOutput(Array.isArray(p.output) ? p.output[0] : p.output);
          const { data } = await patch({ status: "succeeded", output_path: path });
          return json({ job: data });
        } catch (e) { return fail(String((e as Error).message), 502); }
      }
      if (p.status === "failed" || p.status === "canceled") return fail(p.error ?? p.status, 200);
      return json({ job });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
