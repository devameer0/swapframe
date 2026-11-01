import './style.css';
import { createClient } from '@supabase/supabase-js';
import { DEFAULTS, applyTheme } from './settings.js';

const cfg = window.SWAPFRAME_CONFIG || {};
const configured = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.startsWith('YOUR_') && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

let S = { ...DEFAULTS };
const LIMITS = { maxBytes: 100 * 1024 * 1024, minSec: 10, maxSec: 30, maxImg: 10 * 1024 * 1024,
  video: ['video/mp4', 'video/quicktime', 'video/webm'], image: ['image/png', 'image/jpeg', 'image/webp'] };
const app = document.getElementById('app');
const $ = (s) => app.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let session = null, pollTimer = null;

const notice = configured ? '' : `<div class="notice" id="cfg-notice"><b>Backend not configured yet.</b> This is a preview of the UI.
  Add your Supabase URL and anon key to <code>config.js</code> to enable sign up, uploads and generation. See the README.</div>`;

function shell(body) {
  const links = session
    ? `<a href="#/dashboard">Dashboard</a><a href="#" id="logout">Sign out</a>`
    : `<a href="#/signin">Sign in</a><a href="#/signup">Sign up</a>`;
  const name = esc(S.site_name);
  const logo = S.logo_url ? `<img src="${esc(S.logo_url)}" alt=""/>${name}` : (S.site_name === 'SwapFrame' ? 'SWAP<b>FRAME</b>' : name);
  const banner = (S.maintenance_mode ? `<div class="announce">${name} is in maintenance mode — generation is paused.</div>` : '') +
    (S.announcement ? `<div class="announce">${esc(S.announcement)}</div>` : '');
  const flinks = (S.footer_links || []).filter((l) => /^https?:/.test(l.url)).map((l) => ` · <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
  app.innerHTML = `${banner}<div class="wrap"><nav><a class="logo" href="#/">${logo}</a><div class="links">${links}</div></nav>
  ${notice}${body}<footer>${name} · ${esc(S.footer_text)}${flinks}</footer></div>`;
  const lo = $('#logout'); if (lo) lo.onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = '#/'; };
}

function landing() {
  shell(`<section class="hero"><div class="tag">${esc(S.tagline)}</div>
  <h1>${esc(S.hero_title)}<br/><span>${esc(S.hero_highlight)}</span></h1>
  <p>${esc(S.hero_text)}</p>
  <p style="margin-top:26px"><a class="btn" href="#/${session ? 'dashboard' : 'signup'}">${session ? 'Open dashboard' : esc(S.cta_text)}</a>
  ${session ? '' : '<a class="btn ghost" href="#/signin" style="margin-left:8px">Sign in</a>'}</p></section>
  <div class="grid">${(S.sections || []).map((c) => `<div class="card"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div>`).join('')}</div>`);
}

function authForm(mode) {
  const up = mode === 'signup';
  if (up && !S.signups_open) { shell(`<div class="form card"><h2>Sign-ups are closed</h2><p style="color:var(--mute)">New accounts are paused right now. Already registered? <a href="#/signin">Sign in</a>.</p></div>`); return; }
  shell(`<form class="form card" id="f"><h2>${up ? 'Create account' : 'Welcome back'}</h2>
   <label>Email</label><input type="email" id="email" required autocomplete="email"/>
   <label>Password</label><input type="password" id="pw" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}"/>
   <p style="margin-top:18px"><button class="btn" ${configured ? '' : 'disabled'}>${up ? 'Sign up' : 'Sign in'}</button></p>
   <div class="err" id="msg"></div>
   <p style="color:var(--mute);font-size:14px">${up ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a>'}</p></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const msg = $('#msg'); msg.className = 'err'; msg.textContent = '';
    if (!sb) { msg.textContent = 'Backend not configured yet.'; return; }
    const email = $('#email').value.trim(), password = $('#pw').value;
    const { data, error } = up ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] + '#/dashboard' } })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = error.message; return; }
    if (up && !data.session) { msg.className = 'err ok'; msg.textContent = 'Check your inbox to confirm your email, then sign in.'; return; }
    location.hash = '#/dashboard';
  };
}

function videoDuration(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(v.duration); };
    v.onerror = () => rej(new Error('Could not read video'));
    v.src = URL.createObjectURL(file);
  });
}

async function validate(video, image) {
  if (!video) return 'Choose a video.';
  if (!LIMITS.video.includes(video.type)) return 'Video must be MP4, MOV or WebM.';
  if (video.size > LIMITS.maxBytes) return `Video must be ${S.max_upload_mb} MB or smaller.`;
  const d = await videoDuration(video).catch(() => NaN);
  if (!(d >= LIMITS.minSec && d <= LIMITS.maxSec)) return `Video must be ${LIMITS.minSec}–${LIMITS.maxSec} seconds (yours: ${isNaN(d) ? 'unknown' : d.toFixed(1) + 's'}).`;
  if (!image) return 'Choose a character image.';
  if (!LIMITS.image.includes(image.type)) return 'Image must be PNG, JPG or WebP.';
  if (image.size > LIMITS.maxImg) return 'Image must be 10 MB or smaller.';
  return null;
}

async function dashboard() {
  if (configured && !session) { location.hash = '#/signin'; return; }
  shell(`<div class="dash">
  <div class="card"><h3>New recast</h3><div id="me" style="color:var(--mute);font-size:13px"></div>
   <label>Source video (${LIMITS.minSec}–${LIMITS.maxSec}s, ≤${S.max_upload_mb} MB, MP4/MOV/WebM)</label><input type="file" id="vid" accept="video/mp4,video/quicktime,video/webm"/>
   <label>Character image (PNG/JPG/WebP, ≤10 MB)</label><input type="file" id="img" accept="image/png,image/jpeg,image/webp"/>
   <img id="imgprev" class="preview" hidden alt="character preview"/>
   <label>Quality</label><select id="res"><option value="low">Standard (faster)</option><option value="high">High (slower)</option></select>
   <label class="check" style="margin-top:16px"><input type="checkbox" id="consent"/><span>I own or have permission to use this video and character; no real person's likeness without consent.</span></label>
   <p style="margin-top:16px"><button class="btn" id="go" disabled>Generate</button></p>
   <div class="bar"><i id="prog"></i></div><div id="stat" style="color:var(--mute);font-size:14px">Idle</div><div class="err" id="err"></div>
  </div>
  <div class="card"><h3>Result <span class="ai">AI-GENERATED</span></h3><div id="result" style="color:var(--mute)">Your recast will appear here.</div></div>
  </div><div class="card"><h3>History</h3><div id="hist" style="color:var(--mute)">${configured ? 'Loading…' : 'Sign in to see your jobs.'}</div></div>`);
  const go = $('#go'), consent = $('#consent');
  const refresh = () => { go.disabled = !(configured && consent.checked && $('#vid').files[0] && $('#img').files[0]); };
  ['#vid', '#img', '#consent'].forEach((s) => $(s).addEventListener('change', refresh));
  $('#img').addEventListener('change', () => { const f = $('#img').files[0]; const p = $('#imgprev'); if (f) { p.src = URL.createObjectURL(f); p.hidden = false; } });
  go.onclick = startJob;
  if (configured) { loadHistory(); loadMe(); }
}
async function loadMe() {
  const { data } = await sb.from('profiles').select('banned').eq('id', session.user.id).maybeSingle();
  const el = $('#me'); if (!el || !data) return;
  el.innerHTML = data.banned ? '<span style="color:var(--bad)">Your account is suspended.</span>' : 'Free &amp; unlimited — no credits needed.';
}

const setProg = (pct, text) => { $('#prog').style.width = pct + '%'; $('#stat').textContent = text; };
const ext = (f) => (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');

async function callFn(body) {
  const { data, error } = await sb.functions.invoke('swap', { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
  return data;
}

async function startJob() {
  const err = $('#err'); err.textContent = '';
  const video = $('#vid').files[0], image = $('#img').files[0];
  if (!$('#consent').checked) { err.textContent = 'Please confirm consent.'; return; }
  const v = await validate(video, image); if (v) { err.textContent = v; return; }
  $('#go').disabled = true;
  try {
    const uid = session.user.id, key = crypto.randomUUID();
    setProg(5, 'Uploading video…');
    const vp = `${uid}/${key}-video.${ext(video)}`, ip = `${uid}/${key}-character.${ext(image)}`;
    let r = await sb.storage.from('uploads').upload(vp, video, { contentType: video.type }); if (r.error) throw r.error;
    setProg(15, 'Uploading character…');
    r = await sb.storage.from('uploads').upload(ip, image, { contentType: image.type }); if (r.error) throw r.error;
    const { data: job, error } = await sb.from('jobs').insert({ user_id: uid, video_path: vp, image_path: ip, consent: true }).select().single();
    if (error) throw error;
    setProg(25, 'Starting generation…');
    const dur = await videoDuration(video).catch(() => 10);
    const st = await callFn({ action: 'start', job_id: job.id });
    loadHistory();
    if (st.provider === 'replicate') { poll(job.id); return; }
    await runHF(job.id, st, dur, $('#res').value === 'high' ? 'Medium Res' : 'Low Res');
  } catch (e) { err.textContent = e.message || String(e); setProg(0, 'Failed'); $('#go').disabled = false; }
}

// Free path: call the Hugging Face Space (Gradio HTTP API) straight from the browser, because ZeroGPU jobs
// can run longer than an Edge Function stays alive. The edge function then stores the result.
async function runHF(jobId, st, dur, res) {
  const space = st.space;
  try {
    setProg(30, 'Sending files to the free GPU…');
    const fd = new FormData();
    const [vb, ib] = await Promise.all([fetch(st.video_url).then((r) => r.blob()), fetch(st.image_url).then((r) => r.blob())]);
    fd.append('files', vb, 'video.mp4'); fd.append('files', ib, 'character.png');
    const upRes = await fetch(`${space}/gradio_api/upload`, { method: 'POST', body: fd });
    if (!upRes.ok) throw new Error(`Space upload failed (${upRes.status})`);
    const [vp, ip] = await upRes.json();
    const file = (path) => ({ path, meta: { _type: 'gradio.FileData' } });
    const seconds = Math.max(2, Math.min(20, Math.floor(dur)));
    // Use Gradio's queue protocol (what the Space's own UI and gradio_client use). The simple /call API
    // fails on this Space because it omits the hidden State input, so look up the endpoint and pad inputs.
    const cfg = await fetch(`${space}/config`).then((r) => r.json());
    const fnIndex = cfg.dependencies.findIndex((d) => d.api_name === 'animate_scene');
    if (fnIndex < 0) throw new Error('This Space no longer has the animate_scene endpoint.');
    const data = [file(vp), seconds, file(ip), 'Character Swap', res];
    while (data.length < cfg.dependencies[fnIndex].inputs.length) data.push(null);
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const join = await fetch(`${space}/gradio_api/queue/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, fn_index: fnIndex, trigger_id: null, session_hash: session }) });
    if (!join.ok) throw new Error(`Space queue refused the job (${join.status}): ${(await join.text()).slice(0, 200)}`);
    setProg(40, 'In the free GPU queue… this can take several minutes. Keep this tab open.');
    const stream = await fetch(`${space}/gradio_api/queue/data?session_hash=${session}`);
    if (!stream.ok) throw new Error(`Space stream failed (${stream.status})`);
    const reader = stream.body.getReader(); const dec = new TextDecoder(); let buf = '', out = null, done = false;
    while (!done) {
      const r = await reader.read(); if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let m; try { m = JSON.parse(line.slice(5)); } catch { continue; }
        if (m.msg === 'estimation') setProg(40, `Free GPU queue: position ${(m.rank ?? 0) + 1}${m.rank_eta ? `, about ${Math.round(m.rank_eta)}s` : ''}. Keep this tab open.`);
        else if (m.msg === 'process_starts') setProg(45, 'Rendering on the free GPU…');
        else if (m.msg === 'progress' && m.progress_data?.[0]) { const p = m.progress_data[0]; setProg(Math.min(94, 45 + Math.round(45 * (p.index / (p.length || 1)))), `Rendering on the free GPU… ${p.desc || 'generating'} ${p.index}/${p.length}`); }
        else if (m.msg === 'process_completed') {
          done = true;
          if (!m.success) throw new Error('Hugging Face Space error: ' + (m.output?.error || m.output?.title || 'unknown error (the Space may be out of free GPU quota or busy; try a shorter clip or retry later)'));
          const v = m.output?.data?.[0]; out = v?.url || v?.video?.url || null;
        } else if (m.msg === 'unexpected_error' || m.msg === 'queue_full') { done = true; throw new Error('Hugging Face Space: ' + (m.message || m.msg)); }
      }
    }
    if (!out) throw new Error('The Space finished without a video.');
    setProg(96, 'Saving your result…');
    const { job } = await callFn({ action: 'complete', job_id: jobId, output_url: out });
    setProg(100, 'Done'); showResult(job); loadHistory(); $('#go').disabled = false;
  } catch (e) {
    const r = await callFn({ action: 'fail', job_id: jobId, error: e.message }).catch(() => ({}));
    setProg(0, 'Failed'); $('#err').textContent = e.message + (r.replicate_available ? ' (A paid backup is enabled by the admin.)' : '');
    loadHistory(); $('#go').disabled = false;
  }
}

function poll(id) {
  clearTimeout(pollTimer); let n = 0;
  const tick = async () => {
    try {
      const { job } = await callFn({ action: 'status', job_id: id }); n++;
      if (job.status === 'succeeded') { setProg(100, 'Done'); showResult(job); loadHistory(); $('#go').disabled = false; return; }
      if (job.status === 'failed' || job.status === 'canceled') { setProg(0, 'Failed'); $('#err').textContent = job.error || 'Generation failed'; loadHistory(); $('#go').disabled = false; return; }
      setProg(Math.min(95, 30 + n * 2), `Rendering (${job.status})… free GPU queue, this can take several minutes`);
    } catch (e) { $('#stat').textContent = 'Retrying status… ' + e.message; }
    pollTimer = setTimeout(tick, 6000);
  };
  tick();
}

async function signedResult(path) {
  const { data } = await sb.storage.from('results').createSignedUrl(path, 3600); return data?.signedUrl;
}
async function showResult(job) {
  const url = await signedResult(job.output_path); if (!url) return;
  $('#result').innerHTML = `<video src="${esc(url)}" controls playsinline></video>
   <p style="font-size:13px">This video is AI-generated. <a class="btn ghost" style="padding:6px 12px;margin-left:8px" href="${esc(url)}" download="swapframe-${esc(job.id)}.mp4">Download</a></p>`;
}

async function loadHistory() {
  const h = $('#hist'); if (!h) return;
  const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) { h.textContent = error.message; return; }
  if (!data.length) { h.textContent = 'No jobs yet.'; return; }
  h.innerHTML = `<table><tr><th>Created</th><th>Status</th><th></th></tr>${data.map((j) => `<tr><td>${esc(new Date(j.created_at).toLocaleString())}</td>
   <td><span class="pill ${esc(j.status)}">${esc(j.status)}</span></td><td>${j.status === 'succeeded' ? `<a href="#" data-view="${esc(j.id)}">View</a>`
   : ['queued', 'starting', 'processing'].includes(j.status) && String(j.prediction_id || '').startsWith('replicate:') ? `<a href="#" data-poll="${esc(j.id)}">Track</a>` : esc(j.error || '')}</td></tr>`).join('')}</table>`;
  h.querySelectorAll('[data-view]').forEach((a) => a.onclick = (e) => { e.preventDefault(); showResult(data.find((j) => j.id === a.dataset.view)); });
  h.querySelectorAll('[data-poll]').forEach((a) => a.onclick = (e) => { e.preventDefault(); poll(a.dataset.poll); });
}

function route() {
  clearTimeout(pollTimer);
  const r = location.hash.replace(/^#\/?/, '');
  if (r === 'signup') authForm('signup'); else if (r === 'signin') authForm('signin');
  else if (r === 'dashboard') dashboard(); else landing();
}

async function loadSettings() {
  if (sb) {
    const { data } = await sb.from('site_settings').select('data').eq('id', 1).maybeSingle();
    if (data?.data) S = { ...DEFAULTS, ...data.data };
  }
  LIMITS.maxBytes = Number(S.max_upload_mb) * 1024 * 1024; LIMITS.minSec = Number(S.min_seconds); LIMITS.maxSec = Number(S.max_seconds);
  applyTheme(S);
}

(async () => {
  await loadSettings().catch(() => applyTheme(S));
  if (sb) {
    // live updates when the admin app changes settings (needs Realtime enabled on site_settings; falls back to load-time)
    sb.channel('settings').on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, () => loadSettings().then(route)).subscribe();
    session = (await sb.auth.getSession()).data.session;
    sb.auth.onAuthStateChange((_e, s) => { const changed = !!s !== !!session; session = s; if (changed) route(); });
  }
  window.addEventListener('hashchange', route); route();
})();
