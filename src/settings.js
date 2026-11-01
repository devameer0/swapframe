// Default site settings. Admin edits are stored in site_settings.data and merged over these.
export const DEFAULTS = {
  site_name: 'SwapFrame',
  logo_url: '',
  tagline: '// RECAST ANY CLIP',
  hero_title: 'Your character.',
  hero_highlight: 'Their every move.',
  hero_text: 'Upload a short video and a character image. SwapFrame replaces the person on screen with your character while keeping the original motion, camera and background.',
  cta_text: 'Get started',
  announcement: '',
  sections: [
    { title: '01 · Drop a clip', text: 'MP4, MOV or WebM, 2–20 seconds, up to 100 MB. Short clips render fastest.' },
    { title: '02 · Pick a character', text: 'A clear PNG, JPG or WebP of the character you want in the shot.' },
    { title: '03 · Get the recast', text: 'Same motion and framing, new performer. Download it or find it in your history.' },
  ],
  footer_text: 'Outputs are AI-generated. Only use footage and characters you own or have permission to use.',
  footer_links: [{ label: 'GitHub', url: 'https://github.com/devameer0/swapframe' }],
  theme: 'dark',
  primary: '#ffffff',
  accent: '#a6a6a6',
  font: 'figtree',
  background: '',
  max_upload_mb: 100,
  min_seconds: 2,
  max_seconds: 20, // the free HF Space renders at most 20s
  daily_limit: 0, // 0 = unlimited (SwapFrame is free for everyone)
  signups_open: true,
  maintenance_mode: false,
};

export const FONTS = {
  figtree: '"Figtree",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
  system: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  serif: 'ui-serif,Georgia,"Times New Roman",serif',
  rounded: '"Nunito","Quicksand",ui-rounded,system-ui,sans-serif',
};

export function applyTheme(s) {
  const r = document.documentElement.style;
  const light = s.theme === 'light';
  const vars = light
    ? { bg: '#f4f4f4', panel: '#ffffff', panel2: '#ebebeb', line: 'rgba(0,0,0,.14)', text: '#0a0a0a', mute: '#5c5c5c' }
    : { bg: '#0a0a0a', panel: '#111111', panel2: '#151515', line: 'rgba(255,255,255,.16)', text: '#ffffff', mute: '#a6a6a6' };
  for (const [k, v] of Object.entries(vars)) r.setProperty('--' + k, v);
  let acc = s.primary || DEFAULTS.primary;
  if (light && /^#f{3,6}$/i.test(acc)) acc = '#0a0a0a'; // keep contrast on light theme
  r.setProperty('--acc', acc);
  r.setProperty('--acc2', s.accent || DEFAULTS.accent);
  r.setProperty('--font', FONTS[s.font] || FONTS.figtree);
  r.setProperty('--bgimg', s.background ? (/^(https?:|data:)/.test(s.background) ? `url("${s.background.replace(/"/g, '')}") center/cover fixed` : s.background) : 'none');
  document.title = `${s.site_name} — recast any clip`;
}
