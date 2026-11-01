// SwapFrame admin edge function. Every call verifies the caller's profile has role = 'admin'.
// POST {action:"delete_user", user_id}  -> deletes the user's files, jobs, profile and auth account
// POST {action:"delete_jobs", user_id, job_ids?} -> deletes jobs (all, or given ids) and their files
import { createClient } from "npm:@supabase/supabase-js@2";
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
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role,banned").eq("id", user.id).single();
    if (me?.role !== "admin" || me?.banned) return json({ error: "Admins only" }, 403);

    const { action, user_id, job_ids } = await req.json();
    if (!user_id) return json({ error: "user_id required" }, 400);

    const purgeJobs = async (ids?: string[]) => {
      let q = admin.from("jobs").select("id,video_path,image_path,output_path").eq("user_id", user_id);
      if (ids?.length) q = q.in("id", ids);
      const { data: jobs } = await q;
      const up = (jobs ?? []).flatMap((j) => [j.video_path, j.image_path]).filter(Boolean);
      const res = (jobs ?? []).map((j) => j.output_path).filter(Boolean);
      if (up.length) await admin.storage.from("uploads").remove(up);
      if (res.length) await admin.storage.from("results").remove(res);
      if (jobs?.length) await admin.from("jobs").delete().in("id", jobs.map((j) => j.id));
      return jobs?.length ?? 0;
    };

    if (action === "delete_jobs") return json({ deleted: await purgeJobs(job_ids) });
    if (action === "delete_user") {
      if (user_id === user.id) return json({ error: "You can't delete your own admin account here" }, 400);
      const deleted = await purgeJobs();
      // sweep any stray files under the user's folder
      for (const b of ["uploads", "results"]) {
        const { data: files } = await admin.storage.from(b).list(user_id, { limit: 1000 });
        if (files?.length) await admin.storage.from(b).remove(files.map((f) => `${user_id}/${f.name}`));
      }
      const { error } = await admin.auth.admin.deleteUser(user_id); // cascades to profiles
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, jobs_deleted: deleted });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
