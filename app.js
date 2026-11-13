const samples = [
  {id:'general',name:'General Server',map:'Cuarentena Chill',image:'cc',kind:'official',count:38,max:40},
  {id:'espanol',name:'Servidor Español',map:'Cuarentena Chill',image:'cc',kind:'official',count:27,max:40},
  {id:'sunset',name:'Sunset Social',map:'Slap Royale',image:'slap',kind:'community',count:24,max:50},
  {id:'hangout',name:'The Hangout',map:'Cuarentena Chill',image:'cc',kind:'community',count:18,max:40},
  {id:'afterhours',name:'After Hours',map:'Slap Royale',image:'slap',kind:'community',count:12,max:30},
  {id:'goodvibes',name:'Good Vibes Only',map:'Cuarentena Chill',image:'cc',kind:'community',count:8,max:25}
];
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
let mine = read('condo-servers', []);
let profile = read('condo-profile', {name:'',username:''});
let filter = 'all', query = '', selected = null;
const configuredApi = (window.CONDO_API_BASE_URL || '').replace(/\/+$/, '');
const tokenKey = 'condo-guest-token:' + (configuredApi || location.origin);
let mode = 'connecting', liveServers = [], token = localStorage.getItem(tokenKey) || '', guestPromise = null;
const servers = () => mode === 'demo' ? [...samples, ...mine] : liveServers;
async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(configuredApi + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not connect to the server.'), { status: response.status });
  return data;
}
async function ensureGuest() {
  if (token) return;
  if (!guestPromise) guestPromise = api('/api/guests', { method: 'POST' }).then(data => { token = data.token; localStorage.setItem(tokenKey, token); }).finally(() => { guestPromise = null; });
  await guestPromise;
}
async function refreshLive() {
  const data = await api('/api/servers');
  liveServers = data.servers;
  mine = token ? (await api('/api/servers/mine')).servers : [];
  if (selected) { try { selected = await findServer(selected.id); } catch (error) { if (error.status === 404) selected = null; else throw error; } }
}

const button = (label, action, cls='') => `<button type="button" class="button ${cls}" data-action="${action}">${label}</button>`;
function render() {
  $('#modeLabel').innerHTML = `<i></i> ${mode === 'live' ? 'CONNECTED' : mode === 'demo' ? 'DEMO MODE' : mode === 'offline' ? 'OFFLINE' : 'CONNECTING'}`;
  const all = servers();
  const visible = all.filter(s => (filter === 'all' || s.kind === filter) && `${s.name} ${s.map}`.toLowerCase().includes(query));
  $('#serverCount').textContent = all.length;
  $('#onlineCount').textContent = mode === 'live' ? '—' : all.reduce((n,s)=>n+(s.count || 0),0);
  $('.online').title = mode === 'live' ? 'Player counts are unavailable until a game service is connected.' : '';
  $('#resultCount').textContent = visible.length;
  $('#showingCount').textContent = visible.length;
  $('#serverGrid').innerHTML = visible.length ? visible.map((s,i) => {
    const avatars = Array.from({length:Math.min(s.count,4)},(_,n)=>`<span class="avatar">${['A','M','J','K'][(n+i)%4]}</span>`).join('');
    return `<article class="server-card ${selected?.id === s.id ? 'selected' : ''}"><div class="map-image" style="background-image:url('assets/${s.image === 'slap' ? 'slap' : 'cc'}.webp')"><span class="type ${s.kind}">${s.kind.toUpperCase()}</span><div class="map-label"><span>◇</span>${escapeHtml(s.map)}</div></div><div class="server-body"><div class="server-title"><h3>${escapeHtml(s.name)}</h3><span class="more">···</span></div><div class="server-meta"><div class="avatars" aria-label="${s.count} players">${avatars}${s.count > 4 ? `<span class="avatar extra">+${s.count-4}</span>` : s.count == null ? '<span class="profile-handle">Players unavailable</span>' : s.count === 0 ? '<span class="profile-handle">Be the first to join</span>' : ''}</div><div class="capacity">${s.count ?? '—'}<span> / ${s.max} players</span></div></div><div class="progress"><span style="width:${Math.min(100,100*s.count/s.max)}%"></span></div><div class="server-actions"><button class="button" data-select="${escapeHtml(s.id)}">${selected?.id === s.id ? 'Selected' : 'Select'}</button><button class="button gold" data-join="${escapeHtml(s.id)}" ${s.count >= s.max ? 'disabled' : ''}>${s.count >= s.max ? 'Full' : 'Join server'} <span>↗</span></button></div></div></article>`;
  }).join('') : `<div class="empty-results"><strong>${mode === 'offline' ? 'Backend unavailable' : mode === 'connecting' ? 'Connecting…' : query || filter !== 'all' ? 'No servers found' : mode === 'live' ? 'No servers yet' : 'No servers found'}</strong>${mode === 'offline' ? 'Check your connection and try refresh.' : mode === 'live' && !query && filter === 'all' ? 'Create a server to get started.' : 'Try another search or choose a different category.'}</div>`;
  $('#profileName').innerHTML = `${escapeHtml(profile.name || 'Guest player')} <span class="guest-badge">GUEST</span>`;
  $('#profileAvatar').textContent = profile.name ? profile.name[0].toUpperCase() : '?';
  $('.mini-avatar').textContent = profile.name ? profile.name[0].toUpperCase() : '?';
  $('#profileHandle').textContent = profile.username ? '@'+profile.username : 'No username set';
  renderJoin();
}
function renderJoin() {
  const target = $('#joinContent');
  if (!selected) {
    target.innerHTML = `<div class="empty-target"><div class="empty-icon">⌁</div><strong>No server selected</strong><p>Choose a server from the list to get started.</p></div><div class="id-row"><input id="serverId" placeholder="Or enter a server ID" aria-label="Server ID"><button class="button" data-action="select-id">Select</button></div><button class="button gold" disabled>Select a server to join</button>`;
  } else {
    target.innerHTML = `<div class="target-box"><strong>${escapeHtml(selected.name)}</strong><p>${escapeHtml(selected.map)} · ${selected.count ?? '—'}/${selected.max} players</p><p>Server ID: ${escapeHtml(selected.id)}</p><div class="target-controls">${button('Share link','share')}${button('Change','clear')}</div></div><button class="button gold" data-action="join-selected" ${selected.count >= selected.max ? 'disabled' : ''}>${selected.count >= selected.max ? 'Server is full' : 'Join server ↗'}</button>`;
  }
}
async function findServer(id) {
  const known = servers().find(s => s.id === id) || mine.find(s => s.id === id);
  if (known || mode !== 'live') return known || null;
  return (await api('/api/servers/' + encodeURIComponent(id))).server;
}
async function select(id) { try { selected = await findServer(id); render(); if (!selected) toast('Server not found'); return !!selected; } catch (error) { toast(error.status === 404 ? 'Server not found' : error.message); return false; } }
function modal(content) { $('#modalContent').innerHTML = content; $('#modal').showModal(); }
function closeModal() { if ($('#modal').open) $('#modal').close(); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2600); }
function openProfile() {
  modal(`<div class="modal-head"><h2>Your player</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p class="modal-copy">Introduce yourself to the community. ${mode === 'live' ? 'Your guest profile is stored by the server; this browser keeps your session.' : 'Your profile is saved in this browser.'}</p><form id="profileForm"><label class="field">Display name<input class="form-input" name="name" value="${escapeHtml(profile.name)}" placeholder="What should we call you?" minlength="2" maxlength="24" required></label><label class="field">Username <span class="modal-note">(optional)</span><input class="form-input" name="username" value="${escapeHtml(profile.username)}" placeholder="Your username" maxlength="24"></label><div class="modal-actions">${button('Cancel','close')}<button class="button gold" type="submit">Save profile</button></div></form>`);
}
function openCreate() {
  modal(`<div class="modal-head"><h2>Create a server</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p class="modal-copy">Make a space for your people. ${mode === 'live' ? 'Choose whether your listing is public or accessible by link.' : 'Created servers are saved in this browser.'}</p><form id="createForm"><label class="field">Server name<input class="form-input" name="name" placeholder="Give your server a name" minlength="2" maxlength="32" required></label><label class="field">Map<select class="form-input" name="map"><option value="cc">Cuarentena Chill</option><option value="slap">Slap Royale</option></select></label><label class="field">Visibility<select class="form-input" name="visibility"><option value="private">Unlisted (share by link)</option><option value="public">Public</option></select></label><label class="field">Maximum players<select class="form-input" name="max"><option>10</option><option>20</option><option selected>40</option><option>50</option></select></label><div class="modal-actions">${button('Cancel','close')}<button class="button gold" type="submit">Create server</button></div></form>`);
}
function openMine() {
  modal(`<div class="modal-head"><h2>My servers</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p class="modal-copy">${mode === 'live' ? 'Servers created by your guest session appear here.' : 'Your locally created servers appear here.'}</p>${mine.length ? mine.map(s=>`<div class="target-box"><strong>${escapeHtml(s.name)}</strong><p>${escapeHtml(s.map)} · up to ${s.max} players</p><div class="target-controls"><button class="button" data-select-mine="${escapeHtml(s.id)}">Select server</button><button class="button" data-delete="${escapeHtml(s.id)}">Delete</button></div></div>`).join('') : '<div class="empty-target"><div class="empty-icon">✧</div><strong>No servers yet</strong><p>Create your first space to get started.</p></div>'}<div class="modal-actions">${button('Create a server','create','gold')}</div>`);
}
function openJoin() {
  if (!selected || selected.count >= selected.max) return;
  modal(`<div class="modal-head"><h2>Ready to join?</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p class="modal-copy">You selected <strong>${escapeHtml(selected.name)}</strong> on ${escapeHtml(selected.map)}.</p><div class="notice"><span>✦</span><p>${mode === 'demo' ? 'This is a demo. Connecting to a live game server requires a backend integration.' : 'A game connection has not been configured yet.'}</p></div><div class="modal-actions">${button('Back','close')}${button(profile.name ? 'Edit player profile' : 'Set up your player','profile','gold')}</div>`);
}
document.addEventListener('click', async e => {
  const sel=e.target.closest('[data-select]'), join=e.target.closest('[data-join]'), mineSelect=e.target.closest('[data-select-mine]'), del=e.target.closest('[data-delete]'), action=e.target.closest('[data-action]'), tab=e.target.closest('[data-filter]');
  if (tab) { filter=tab.dataset.filter; document.querySelectorAll('[data-filter]').forEach(t=>{t.classList.toggle('active',t===tab);t.setAttribute('aria-selected',String(t===tab));}); render(); }
  if (sel) await select(sel.dataset.select);
  if (join && await select(join.dataset.join)) openJoin();
  if (mineSelect && await select(mineSelect.dataset.selectMine)) closeModal();
  if (del) {
    try {
      if (mode === 'live') { await api('/api/servers/' + encodeURIComponent(del.dataset.delete), { method: 'DELETE' }); liveServers = liveServers.filter(s => s.id !== del.dataset.delete); }
      else if (mode === 'demo') { localStorage.setItem('condo-servers', JSON.stringify(mine.filter(s => s.id !== del.dataset.delete))); }
      else throw new Error('Backend unavailable');
      mine = mine.filter(s => s.id !== del.dataset.delete); if (selected?.id === del.dataset.delete) selected = null; render(); closeModal(); openMine();
    } catch (error) { toast(error.message); }
  }
  if (!action) return;
  switch(action.dataset.action) {
    case 'profile': if ($('#modal').open) closeModal(); openProfile(); break;
    case 'create': case 'create-nav': if ($('#modal').open) closeModal(); openCreate(); break;
    case 'my-servers': if ($('#modal').open) closeModal(); openMine(); break;
    case 'close': closeModal(); break;
    case 'refresh': try { if (mode === 'live') await refreshLive(); else if (mode === 'offline') { await boot(); break; } render(); toast('Server list refreshed'); } catch (error) { toast(error.message); } break;
    case 'clear': selected=null; render(); break;
    case 'join-selected': openJoin(); break;
    case 'select-id': { const id=$('#serverId').value.trim(); if (id) await select(id); else toast('Enter a server ID'); break; }
    case 'share': { const url=new URL('./',location.href); url.searchParams.set('serverid',selected.id); try { await navigator.clipboard.writeText(url.toString()); toast(mode === 'demo' && selected.id.startsWith('private-') ? 'Link copied; this server is saved in this browser' : 'Server link copied'); } catch { toast('Could not copy link'); } break; }
  }
});
document.addEventListener('submit', async e => {
  if (!['profileForm', 'createForm'].includes(e.target.id)) return;
  e.preventDefault();
  const form = e.target, data = new FormData(form), submit = form.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    if (mode === 'offline' || mode === 'connecting') throw new Error('Backend unavailable');
    if (form.id === 'profileForm') {
      const next = { name: String(data.get('name')).trim(), username: String(data.get('username')).trim() };
      if (next.name.length < 2) throw new Error('Enter a display name with at least 2 characters.');
      if (mode === 'live') { await ensureGuest(); profile = await api('/api/profile', { method: 'PUT', body: next }); }
      else { profile = next; localStorage.setItem('condo-profile', JSON.stringify(profile)); }
      if (form.isConnected) closeModal(); render(); toast('Profile saved');
    }
    if (form.id === 'createForm') {
      const name = String(data.get('name')).trim(), image = String(data.get('map')), max = Number(data.get('max')), visibility = String(data.get('visibility'));
      if (name.length < 2) throw new Error('Enter a server name with at least 2 characters.');
      let server;
      if (mode === 'live') { await ensureGuest(); server = (await api('/api/servers', { method: 'POST', body: { name, image, max, visibility } })).server; if (visibility === 'public') liveServers.unshift(server); }
      else { server = { id:'private-'+Date.now().toString(36), name, map:image==='slap'?'Slap Royale':'Cuarentena Chill', image, kind:'community', count:0, max }; localStorage.setItem('condo-servers', JSON.stringify([...mine, server])); }
      mine.unshift(server); selected = server; filter = 'all'; query = ''; $('#search').value = '';
      document.querySelectorAll('[data-filter]').forEach(t => { t.classList.toggle('active', t.dataset.filter === 'all'); t.setAttribute('aria-selected', String(t.dataset.filter === 'all')); });
      if (form.isConnected) closeModal(); render(); toast('Server created');
    }
  } catch (error) { toast(error.message); } finally { submit.disabled = false; }
});
$('#search').addEventListener('input', e=>{query=e.target.value.trim().toLowerCase();render();});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')) closeModal();});
async function boot() {
  mode = 'connecting'; render();
  try {
    const response = await fetch(configuredApi + '/api/config', { cache: 'no-store' });
    if (response.status === 404 && !configuredApi) { mode = 'demo'; mine = read('condo-servers', []); profile = read('condo-profile', {name:'',username:''}); }
    else {
      if (!response.ok) throw new Error('Backend unavailable');
      const config = await response.json();
      if (config.service !== 'condo-api') throw new Error('Backend unavailable');
      mode = 'live'; profile = token ? await api('/api/profile') : {name:'',username:''}; await refreshLive();
    }
    const requested = new URLSearchParams(location.search).get('serverid');
    if (requested) { try { selected = await findServer(requested); } catch (error) { if (error.status !== 404) throw error; } }
  } catch (error) { mode = 'offline'; liveServers = []; mine = []; toast(error.message); }
  render();
}
boot();
