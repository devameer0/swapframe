// Anonymous proxy to the HF ZeroGPU Space black-forest-labs/FLUX.2-klein-4B (/infer), authenticated with the owner's
// HF token (stored in private.app_secrets, read via service-role-only RPC get_app_secret) for a bigger ZeroGPU quota.
// POST JSON {photo: dataURL, character: dataURL, prompt, width, height} -> {image: dataURL} | {error, quota?}
import { createClient } from "jsr:@supabase/supabase-js@2";
const SPACE = "https://black-forest-labs-flux-2-klein-4b.hf.space";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
let TOKEN: string | null = null;
async function token() {
  if (TOKEN) return TOKEN;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.rpc("get_app_secret", { n: "HF_TOKEN" });
  if (error || !data) throw new Error("HF token not configured");
  return (TOKEN = String(data).trim());
}
function toBlob(d: string) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(d || ""); if (!m) throw new Error("bad image");
  const bin = atob(m[2]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  if (u.length > 12 * 1024 * 1024) throw new Error("image too large");
  return new Blob([u], { type: m[1] });
}
const DEFAULT_PROMPT = "Redraw the person in image 1 in the exact art style of the character in image 2: same chibi proportions, same big eye style and eye color, same blush, same line work and flat shading. Keep image 1's hairstyle, hair color, clothes, accessories, pose, framing and background exactly the same. Do not copy image 2's hair, clothes or background.";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  try {
    const b = await req.json();
    const auth = { Authorization: `Bearer ${await token()}` };
    const r16 = (v: unknown, d: number) => Math.min(1536, Math.max(256, Math.round((Number(v) || d) / 16) * 16));
    const w = r16(b.width, 1024), h = r16(b.height, 1024);
    const prompt = String(b.prompt || DEFAULT_PROMPT).slice(0, 2000);
    const fd = new FormData(); fd.append("files", toBlob(b.photo), "photo.png"); fd.append("files", toBlob(b.character), "character.png");
    const up = await fetch(`${SPACE}/gradio_api/upload`, { method: "POST", body: fd, headers: auth });
    if (!up.ok) return j({ error: `upload failed (${up.status})` }, 502);
    const paths: string[] = await up.json();
    const cfg = await fetch(`${SPACE}/config`, { headers: auth }).then((r) => r.json());
    const fnIndex = cfg.dependencies.findIndex((d: { api_name: string }) => d.api_name === "infer");
    if (fnIndex < 0) return j({ error: "Space no longer has /infer" }, 502);
    const f = (p: string) => ({ image: { path: p, meta: { _type: "gradio.FileData" } } });
    const data: unknown[] = [prompt, [f(paths[0]), f(paths[1])], "Distilled (4 steps)", 0, true, w, h, 4, 1.0, false];
    while (data.length < cfg.dependencies[fnIndex].inputs.length) data.push(null);
    const sh = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const jr = await fetch(`${SPACE}/gradio_api/queue/join`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ data, fn_index: fnIndex, trigger_id: null, session_hash: sh }) });
    if (!jr.ok) return j({ error: `queue join failed (${jr.status}): ${(await jr.text()).slice(0, 200)}` }, 502);
    const stream = await fetch(`${SPACE}/gradio_api/queue/data?session_hash=${sh}`, { headers: auth });
    const rd = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", out: string | null = null;
    const deadline = Date.now() + 140000;
    outer: while (Date.now() < deadline) {
      const { value, done } = await rd.read(); if (done) break;
      buf += value; let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = ev.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
        let m; try { m = JSON.parse(line.slice(5)); } catch { continue; }
        if (m.msg === "process_completed") {
          if (!m.success) { const e = String(m.output?.error || "generation failed"); return j({ error: e, quota: /quota|exceeded|GPU/i.test(e) }, 502); }
          const o = m.output?.data?.[0]; out = o?.url || (o?.path ? `${SPACE}/gradio_api/file=${o.path}` : null); break outer;
        }
      }
    }
    rd.cancel().catch(() => {});
    if (!out) return j({ error: "timed out waiting for the GPU" }, 504);
    const img = await fetch(out, { headers: auth }); if (!img.ok) return j({ error: `result fetch failed (${img.status})` }, 502);
    const bytes = new Uint8Array(await img.arrayBuffer()); let s = "";
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return j({ image: `data:${img.headers.get("content-type") || "image/webp"};base64,${btoa(s)}` });
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});
