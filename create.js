(() => {
  const form = document.querySelector('#createPageForm');
  const error = document.querySelector('#createError');
  const submit = form.querySelector('[type=submit]');
  const base = (window.CONDO_API_BASE_URL || '').replace(/\/+$/, '');
  const tokenKey = 'condo-guest-token:' + (base || location.origin);
  let token = localStorage.getItem(tokenKey) || '', mode = 'connecting';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  function placeId(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    if (/^[1-9][0-9]{0,19}$/.test(input)) return input;
    try {
      const url = new URL(input), safe = url.protocol === 'https:' && !url.username && !url.password && !url.port;
      const match = /^\/games\/([1-9][0-9]{0,19})(?:\/[^/]*)?\/?$/.exec(url.pathname);
      if (safe && ['www.roblox.com', 'roblox.com'].includes(url.hostname) && match && ![...url.searchParams.keys()].some(key => /^(privateServerLinkCode|linkCode)$/i.test(key))) return match[1];
      const params = [...url.searchParams.entries()];
      if (safe && url.hostname === 'play.roblox.com' && url.pathname === '/games/start' && params.length === 1 && params[0][0] === 'placeId' && /^[1-9][0-9]{0,19}$/.test(params[0][1])) return params[0][1];
    } catch (_) {}
    throw new Error('Enter a public Roblox game URL or a numeric Place ID.');
  }
  async function api(path, options = {}) {
    const response = await fetch(base + path, { method: options.method || 'GET', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Could not connect to the server.'), { status: response.status });
    return data;
  }
  function displayMode() { document.querySelector('#createMode').innerHTML = `<i></i> ${mode === 'live' ? 'CONNECTED' : mode === 'demo' ? 'DEMO MODE' : mode === 'offline' ? 'OFFLINE' : mode === 'session' ? 'SESSION EXPIRED' : 'CONNECTING'}`; }
  async function boot() {
    try {
      const response = await fetch(base + '/api/config', { cache: 'no-store' });
      if (response.status === 404 && !base) { mode = 'demo'; document.querySelector('#createDemoNotice').hidden = false; document.querySelector('#listingCount').textContent = String(read('condo-servers', []).length); }
      else {
        if (!response.ok || (await response.json()).service !== 'condo-api') throw new Error('Backend unavailable');
        mode = 'live';
        const servers = token ? (await api('/api/servers/mine')).servers : [];
        document.querySelector('#listingCount').textContent = `${servers.length} / 10`;
      }
      submit.disabled = false;
    } catch (e) {
      mode = e.status === 401 ? 'session' : 'offline';
      error.textContent = mode === 'session' ? 'Your saved session was rejected. Open Your profile to sign in again.' : 'The backend is unavailable. Please try again later.';
    }
    displayMode();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true; error.textContent = '';
    try {
      const data = new FormData(form), name = String(data.get('name')).trim(), image = String(data.get('map')), max = Number(data.get('max')), visibility = String(data.get('visibility')), game = placeId(data.get('game'));
      if (name.length < 2 || name.length > 32) throw new Error('Enter a server name with 2–32 characters.');
      let server;
      if (mode === 'live') {
        if (!token) { token = (await api('/api/guests', { method: 'POST' })).token; localStorage.setItem(tokenKey, token); }
        server = (await api('/api/servers', { method: 'POST', body: { name, image, max, visibility, placeId: game } })).server;
      } else if (mode === 'demo') {
        server = { id: 'private-' + Date.now().toString(36), name, map: image === 'slap' ? 'Slap Royale' : 'Cuarentena Chill', image, kind: 'community', count: 0, max, ...(game ? { placeId: game } : {}) };
        localStorage.setItem('condo-servers', JSON.stringify([...read('condo-servers', []), server]));
      } else throw new Error('The backend is unavailable. Please try again later.');
      const url = new URL('./', location.href); url.searchParams.set('serverid', server.id); location.assign(url.href);
    } catch (e) { error.textContent = e.status === 401 ? 'Your saved session was rejected. Open Your profile to sign in again.' : e.message || 'Could not connect to the server.'; submit.disabled = false; }
  });
  displayMode(); boot();
})();
