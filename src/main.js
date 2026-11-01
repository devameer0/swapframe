import './style.css';
import { createClient } from '@supabase/supabase-js';
import { DEFAULTS, applyTheme } from './settings.js';

const cfg = window.SWAPFRAME_CONFIG || {};
const configured = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.startsWith('YOUR_') && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

let S = { ...DEFAULTS };
const LIMITS = { maxBytes: 15 * 1024 * 1024, maxImg: 15 * 1024 * 1024, image: ['image/png', 'image/jpeg', 'image/webp'] };
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

const USER_RE = /^[A-Za-z0-9_]{3,20}$/;
async function toEmail(id) {
  if (id.includes('@')) return id;
  const { data, error } = await sb.rpc('email_for_username', { u: id });
  if (error) throw error; if (!data) throw new Error('No account with that username.');
  return data;
}

function authForm(mode) {
  const up = mode === 'signup';
  if (up && !S.signups_open) { shell(`<div class="form card"><h2>Sign-ups are closed</h2><p style="color:var(--mute)">New accounts are paused right now. Already registered? <a href="#/signin">Sign in</a>.</p></div>`); return; }
  shell(`<form class="form card" id="f"><h2>${up ? 'Create account' : 'Welcome back'}</h2>
   ${up ? `<label>Username</label><input type="text" id="un" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="username"/><div id="unmsg" style="font-size:13px;color:var(--mute)">3–20 letters, numbers or _</div>
   <label>Email</label><input type="email" id="email" required autocomplete="email"/>`
   : `<label>Username or email</label><input type="text" id="email" required autocomplete="username"/>`}
   <label>Password</label><input type="password" id="pw" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}"/>
   <p style="margin-top:18px"><button class="btn" ${configured ? '' : 'disabled'}>${up ? 'Sign up' : 'Sign in'}</button></p>
   <div class="err" id="msg"></div>
   <p style="color:var(--mute);font-size:14px">${up ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a> · <a href="#/forgot">Forgot password?</a>'}</p></form>`);
  let unOk = false;
  if (up) {
    let t; $('#un').oninput = () => { clearTimeout(t); const v = $('#un').value.trim(), m = $('#unmsg'); unOk = false;
      if (!USER_RE.test(v)) { m.style.color = 'var(--mute)'; m.textContent = '3–20 letters, numbers or _'; return; }
      t = setTimeout(async () => { if (!sb) return; const { data } = await sb.rpc('username_available', { u: v });
        if ($('#un').value.trim() !== v) return; unOk = !!data; m.style.color = data ? 'var(--ok,#7ee787)' : 'var(--bad)'; m.textContent = data ? 'Username available' : 'Username taken'; }, 300); };
  }
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const msg = $('#msg'); msg.className = 'err'; msg.textContent = '';
    if (!sb) { msg.textContent = 'Backend not configured yet.'; return; }
    const id = $('#email').value.trim(), password = $('#pw').value;
    try {
      if (up) {
        const username = $('#un').value.trim();
        if (!USER_RE.test(username)) throw new Error('Username must be 3–20 letters, numbers or _.');
        const { data: free } = await sb.rpc('username_available', { u: username }); if (!free) throw new Error('Username taken.');
        const { data, error } = await sb.auth.signUp({ email: id, password, options: { data: { username }, emailRedirectTo: location.href.split('#')[0] + '#/dashboard' } });
        if (error) throw error;
        if (!data.session) { msg.className = 'err ok'; msg.textContent = 'Check your inbox to confirm your email, then sign in.'; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: await toEmail(id), password }); if (error) throw error;
      }
      location.hash = '#/dashboard';
    } catch (er) { msg.textContent = er.message; }
  };
}

function forgot() {
  shell(`<form class="form card" id="f"><h2>Reset password</h2><p style="color:var(--mute);font-size:14px">We'll email you a 6-digit code.</p>
   <label>Username or email</label><input type="text" id="id" required/>
   <p style="margin-top:18px"><button class="btn" ${configured ? '' : 'disabled'}>Send code</button></p><div class="err" id="msg"></div>
   <p style="color:var(--mute);font-size:14px"><a href="#/signin">Back to sign in</a></p></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const msg = $('#msg'); msg.className = 'err'; msg.textContent = '';
    try {
      const email = await toEmail($('#id').value.trim());
      const { error } = await sb.auth.resetPasswordForEmail(email); if (error) throw error;
      resetCode(email);
    } catch (er) { msg.textContent = er.message; }
  };
}
function resetCode(email) {
  shell(`<form class="form card" id="f"><h2>Enter your code</h2><p style="color:var(--mute);font-size:14px">If an account exists, a 6-digit code was sent to ${esc(email.replace(/^(.).*(@.*)$/, '$1•••$2'))}.</p>
   <label>6-digit code</label><input type="text" id="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"/>
   <label>New password</label><input type="password" id="pw" required minlength="8" autocomplete="new-password"/>
   <p style="margin-top:18px"><button class="btn">Set new password</button></p><div class="err" id="msg"></div></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const msg = $('#msg'); msg.className = 'err'; msg.textContent = '';
    try {
      const { error } = await sb.auth.verifyOtp({ email, token: $('#code').value.trim(), type: 'recovery' }); if (error) throw error;
      const r = await sb.auth.updateUser({ password: $('#pw').value }); if (r.error) throw r.error;
      msg.className = 'err ok'; msg.textContent = 'Password updated.'; setTimeout(() => { location.hash = '#/dashboard'; }, 800);
    } catch (er) { msg.textContent = er.message; }
  };
}

function validate(photo, image) {
  if (!photo) return 'Choose a photo.';
  if (!LIMITS.image.includes(photo.type)) return 'Photo must be JPG, PNG or WebP.';
  if (photo.size > LIMITS.maxBytes) return `Photo must be ${S.max_upload_mb} MB or smaller.`;
  if (!image) return 'Choose a character image.';
  if (!LIMITS.image.includes(image.type)) return 'Character image must be PNG, JPG or WebP.';
  if (image.size > LIMITS.maxImg) return 'Character image must be 15 MB or smaller.';
  return null;
}

async function dashboard() {
  if (configured && !session) { location.hash = '#/signin'; return; }
  shell(`<div class="dash">
  <div class="card"><h3>New restyle</h3><div id="me" style="color:var(--mute);font-size:13px"></div>
   <label>Your photo (JPG/PNG/WebP, ≤${S.max_upload_mb} MB)</label><input type="file" id="vid" accept="image/jpeg,image/png,image/webp"/>
   <img id="vidprev" class="preview" hidden alt="photo preview"/>
   <label>Character style (PNG/JPG/WebP, ≤15 MB)</label><input type="file" id="img" accept="image/png,image/jpeg,image/webp"/>
   <img id="imgprev" class="preview" hidden alt="character preview"/>
   <label class="check" style="margin-top:16px"><input type="checkbox" id="consent"/><span>I own or have permission to use this photo and character; no real person's likeness without consent.</span></label>
   <p style="margin-top:16px"><button class="btn" id="go" disabled>Generate</button></p>
   <div class="bar"><i id="prog"></i></div><div id="stat" style="color:var(--mute);font-size:14px">Idle</div><div class="err" id="err"></div>
  </div>
  <div class="card"><h3>Result <span class="ai">AI-GENERATED</span></h3><div id="result" style="color:var(--mute)">Your recast will appear here.</div></div>
  </div><div class="card"><h3>History</h3><div id="hist" style="color:var(--mute)">${configured ? 'Loading…' : 'Sign in to see your jobs.'}</div></div>`);
  const go = $('#go'), consent = $('#consent');
  const refresh = () => { go.disabled = !(configured && consent.checked && $('#vid').files[0] && $('#img').files[0]); };
  ['#vid', '#img', '#consent'].forEach((s) => $(s).addEventListener('change', refresh));
  [['#img', '#imgprev'], ['#vid', '#vidprev']].forEach(([i, pv]) => $(i).addEventListener('change', () => { const f = $(i).files[0]; const p = $(pv); if (f) { p.src = URL.createObjectURL(f); p.hidden = false; } }));
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
  const v = validate(video, image); if (v) { err.textContent = v; return; }
  $('#go').disabled = true;
  try {
    const uid = session.user.id, key = crypto.randomUUID();
    setProg(5, 'Uploading photo…');
    const vp = `${uid}/${key}-photo.${ext(video)}`, ip = `${uid}/${key}-character.${ext(image)}`;
    let r = await sb.storage.from('uploads').upload(vp, video, { contentType: video.type }); if (r.error) throw r.error;
    setProg(15, 'Uploading character…');
    r = await sb.storage.from('uploads').upload(ip, image, { contentType: image.type }); if (r.error) throw r.error;
    const { data: job, error } = await sb.from('jobs').insert({ user_id: uid, video_path: vp, image_path: ip, consent: true }).select().single();
    if (error) throw error;
    setProg(25, 'Starting generation…');
    const st = await callFn({ action: 'start', job_id: job.id });
    loadHistory();
    if (st.provider === 'replicate') { poll(job.id); return; }
    await runHF(job.id, st, video);
  } catch (e) { err.textContent = e.message || String(e); setProg(0, 'Failed'); $('#go').disabled = false; }
}

// Free path: call Hugging Face Spaces (Gradio queue API) straight from the visitor's browser so ZeroGPU quota is per visitor.
// black-forest-labs/FLUX.2-klein-4B /infer — multi-reference edit: [photo, character] + prompt => the photo (same person,
// hair, clothes, background) redrawn in the character's art style. No fallback: errors are shown to the user.
const SWAP_PROMPT = "Redraw the person in image 1 in the exact art style of the character in image 2: same chibi proportions, same big eye style and eye color, same blush, same line work and flat shading. Keep image 1's hairstyle, hair color, clothes, accessories, pose, framing and background exactly the same. Do not copy image 2's hair, clothes or background.";
async function gradioRun(space, apiName, buildData, files, label) {
  const fd = new FormData(); files.forEach(([b, n]) => fd.append('files', b, n));
  const upRes = await fetch(`${space}/gradio_api/upload`, { method: 'POST', body: fd });
  if (!upRes.ok) throw new Error(`${label}: upload failed (${upRes.status}): ${(await upRes.text()).slice(0, 200)}`);
  const paths = await upRes.json();
  const cfg = await fetch(`${space}/config`).then((r) => r.json());
  const fnIndex = cfg.dependencies.findIndex((d) => d.api_name === apiName);
  if (fnIndex < 0) throw new Error(`${label}: the Space no longer has the /${apiName} endpoint.`);
  const data = buildData(paths.map((path) => ({ path, meta: { _type: 'gradio.FileData' } })));
  while (data.length < cfg.dependencies[fnIndex].inputs.length) data.push(null);
  const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const join = await fetch(`${space}/gradio_api/queue/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, fn_index: fnIndex, trigger_id: null, session_hash: session }) });
  if (!join.ok) throw new Error(`${label}: queue refused the job (${join.status}): ${(await join.text()).slice(0, 200)}`);
  setProg(40, 'In the free GPU queue… usually under a minute. Keep this tab open.');
  const stream = await fetch(`${space}/gradio_api/queue/data?session_hash=${session}`);
  if (!stream.ok) throw new Error(`${label}: stream failed (${stream.status})`);
  const reader = stream.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const r = await reader.read(); if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let m; try { m = JSON.parse(line.slice(5)); } catch { continue; }
      if (m.msg === 'estimation') setProg(40, `Free GPU queue: position ${(m.rank ?? 0) + 1}${m.rank_eta ? `, about ${Math.round(m.rank_eta)}s` : ''}. Keep this tab open.`);
      else if (m.msg === 'process_starts') setProg(50, `Rendering on the free GPU (${label})…`);
      else if (m.msg === 'progress' && m.progress_data?.[0]) { const p = m.progress_data[0]; setProg(Math.min(94, 50 + Math.round(40 * (p.index / (p.length || 1)))), `Rendering… ${p.desc || ''} ${p.index}/${p.length}`); }
      else if (m.msg === 'process_completed') {
        if (!m.success) throw new Error(`${label} error: ` + ([m.output?.title, m.output?.error].filter(Boolean).join(' — ') || 'unknown error (the Space may be busy or out of free GPU quota; retry later)'));
        const v = m.output?.data?.[0]; const pick = Array.isArray(v) ? v[v.length - 1] : v; // ImageSlider returns [before, after]
        const out = pick?.url || pick?.image?.url || null;
        if (!out) throw new Error(`${label}: finished without an image.`);
        return out;
      } else if (m.msg === 'unexpected_error' || m.msg === 'queue_full') throw new Error(`${label}: ` + (m.message || m.msg));
    }
  }
  throw new Error(`${label}: connection closed before a result.`);
}
const imgSize = (f) => new Promise((res) => { const i = new Image(); i.onload = () => { res([i.naturalWidth, i.naturalHeight]); URL.revokeObjectURL(i.src); }; i.onerror = () => res([1024, 1024]); i.src = URL.createObjectURL(f); });
const resizeBlob = (b, max) => new Promise((res) => { const i = new Image(); i.onload = () => { const k = max / Math.max(i.naturalWidth, i.naturalHeight);
  const c = document.createElement('canvas'); c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
  c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(i.src); c.toBlob((o) => res(o || b), 'image/png'); };
  i.onerror = () => res(b); i.src = URL.createObjectURL(b); });
async function runHF(jobId, st, photo) {
  try {
    setProg(30, 'Sending photos to the free GPU…');
    const [pb, ib] = await Promise.all([fetch(st.photo_url || st.video_url).then((r) => r.blob()), fetch(st.image_url).then((r) => r.blob())]);
    // keep the photo's aspect ratio, longest side 1024, multiples of 16
    let [w, h] = await imgSize(photo); const k = 1024 / Math.max(w, h);
    w = Math.max(256, Math.round(w * k / 16) * 16); h = Math.max(256, Math.round(h * k / 16) * 16);
    const [p1, c1] = await Promise.all([resizeBlob(pb, 1024), resizeBlob(ib, 768)]);
    let out;
    try {
      out = await gradioRun(st.space, st.api_name || 'infer', ([pp, ip]) => [st.prompt || SWAP_PROMPT, [{ image: pp }, { image: ip }], 'Distilled (4 steps)', 0, true, w, h, 4, 1.0, false],
        [[p1, 'photo.png'], [c1, 'character.png']], 'Style transfer');
    } catch (e) { throw new Error(e.message + ' — the free GPU may be busy or your free quota used up. Please try again later.'); }
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
  const isVid = /\.mp4$/.test(job.output_path || ''), fn = `swapframe-${esc(job.id)}.${(job.output_path || '').split('.').pop() || 'webp'}`;
  const blobUrl = await fetch(url).then((r) => r.blob()).then((b) => URL.createObjectURL(b)).catch(() => url);
  $('#result').innerHTML = `<div style="position:relative">${isVid ? `<video src="${esc(url)}" controls playsinline></video>` : `<img src="${esc(url)}" alt="AI-generated result" style="width:100%;border-radius:10px;display:block"/>`}
   <span class="ai" style="position:absolute;left:8px;top:8px">AI-GENERATED</span></div>
   <p style="font-size:13px">This image is AI-generated. <a class="btn ghost" style="padding:6px 12px;margin-left:8px" href="${esc(blobUrl)}" download="${fn}">Download</a></p>`;
}

async function loadHistory() {
  const h = $('#hist'); if (!h) return;
  const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) { h.textContent = error.message; return; }
  if (!data.length) { h.textContent = 'No jobs yet.'; return; }
  h.innerHTML = `<table><tr><th>Created</th><th></th><th>Status</th><th></th></tr>${data.map((j) => `<tr><td>${esc(new Date(j.created_at).toLocaleString())}</td><td>${j.output_path && !/\.mp4$/.test(j.output_path) ? `<img data-thumb="${esc(j.output_path)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px"/>` : ''}</td>
   <td><span class="pill ${esc(j.status)}">${esc(j.status)}</span></td><td>${j.status === 'succeeded' ? `<a href="#" data-view="${esc(j.id)}">View</a>`
   : ['queued', 'starting', 'processing'].includes(j.status) && String(j.prediction_id || '').startsWith('replicate:') ? `<a href="#" data-poll="${esc(j.id)}">Track</a>` : esc(j.error || '')}</td></tr>`).join('')}</table>`;
  h.querySelectorAll('[data-thumb]').forEach(async (im) => { const u = await signedResult(im.dataset.thumb); if (u) im.src = u; });
  h.querySelectorAll('[data-view]').forEach((a) => a.onclick = (e) => { e.preventDefault(); showResult(data.find((j) => j.id === a.dataset.view)); });
  h.querySelectorAll('[data-poll]').forEach((a) => a.onclick = (e) => { e.preventDefault(); poll(a.dataset.poll); });
}

function route() {
  clearTimeout(pollTimer);
  const r = location.hash.replace(/^#\/?/, '');
  if (r === 'signup') authForm('signup'); else if (r === 'signin') authForm('signin');
  else if (r === 'forgot') forgot();
  else if (r === 'dashboard') dashboard(); else landing();
  if (sb) sb.from('page_views').insert({ path: ('/' + r).slice(0, 200), user_id: session?.user?.id ?? null }).then(() => {}, () => {});
}

async function loadSettings() {
  if (sb) {
    const { data } = await sb.from('site_settings').select('data').eq('id', 1).maybeSingle();
    if (data?.data) S = { ...DEFAULTS, ...data.data };
  }
  LIMITS.maxBytes = Math.min(15, Number(S.max_upload_mb) || 15) * 1024 * 1024; S.max_upload_mb = LIMITS.maxBytes / 1048576;
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
