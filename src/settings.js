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
    { title: '01 · Drop a clip', text: 'MP4, MOV or WebM, 10–30 seconds, up to 100 MB.' },
    { title: '02 · Pick a character', text: 'A clear PNG, JPG or WebP of the character you want in the shot.' },
    { title: '03 · Get the recast', text: 'Same motion and framing, new performer. Download it or find it in your history.' },
  ],
  footer_text: 'Outputs are AI-generated. Only use footage and characters you own or have permission to use.',
  footer_links: [{ label: 'GitHub', url: 'https://github.com/devameer0/swapframe' }],
  theme: 'dark',
  primary: '#b6ff3b',
  accent: '#38e1ff',
  font: 'system',
  background: '',
  max_upload_mb: 100,
  min_seconds: 10,
  max_seconds: 30,
  daily_limit: 3,
  signups_open: true,
  maintenance_mode: false,
};

export const FONTS = {
  system: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  serif: 'ui-serif,Georgia,"Times New Roman",serif',
  rounded: '"Nunito","Quicksand",ui-rounded,system-ui,sans-serif',
};

export function applyTheme(s) {
  const r = document.documentElement.style;
  const light = s.theme === 'light';
  const vars = light
    ? { bg: '#f6f7fb', panel: '#ffffff', line: '#e3e6ee', text: '#11131a', mute: '#5b6273' }
    : { bg: '#07080b', panel: '#0f1117', line: '#1e222c', text: '#e8eaf0', mute: '#8a90a0' };
  for (const [k, v] of Object.entries(vars)) r.setProperty('--' + k, v);
  r.setProperty('--acc', s.primary || DEFAULTS.primary);
  r.setProperty('--acc2', s.accent || DEFAULTS.accent);
  r.setProperty('--font', FONTS[s.font] || FONTS.system);
  r.setProperty('--bgimg', s.background ? (/^(https?:|data:)/.test(s.background) ? `url("${s.background.replace(/"/g, '')}") center/cover fixed` : s.background) : 'none');
  document.title = `${s.site_name} — recast any clip`;
}
