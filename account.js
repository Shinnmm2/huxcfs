(() => {
  const $ = selector => document.querySelector(selector);
  const apiBase = (window.CONDO_API_BASE_URL || '').replace(/\/+$/, '');
  const tokenKey = 'condo-guest-token:' + (apiBase || location.origin);
  let token = localStorage.getItem(tokenKey) || '';
  let mode = 'connecting', verification = { enabled: false }, profile = { name: '', username: '' };
  let view = new URLSearchParams(location.search).get('guest') === '1' ? 'guest' : 'one';
  let challenge = null, timer = null, widget = null, captchaToken = '', scriptPromise = null, viewSequence = 0;

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(apiBase + path, {
        method: options.method || 'GET',
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}), cache: 'no-store',
      });
    } catch (_) { throw new Error('Could not connect to the server. Please try again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not connect to the server.');
    return data;
  }
  async function ensureGuest() {
    if (!token) { const guest = await api('/api/guests', { method: 'POST' }); token = guest.token; localStorage.setItem(tokenKey, token); }
  }
  function localProfile() {
    try { return JSON.parse(localStorage.getItem('condo-profile')) || { name: '', username: '' }; }
    catch { return { name: '', username: '' }; }
  }
  function render() {
    $('#accountMode').innerHTML = `<i></i> ${mode === 'live' ? 'CONNECTED' : mode === 'demo' ? 'DEMO MODE' : mode === 'offline' ? 'OFFLINE' : 'CONNECTING'}`;
    if (document.body.dataset.page === 'home') {
      const name = profile.name || profile.robloxUsername || '';
      $('#homeAvatar').textContent = name ? name[0].toUpperCase() : '?';
      $('#welcomeTitle').textContent = name ? `Welcome back, ${name}.` : 'Welcome to TheCondo.';
      $('.home-guest').textContent = profile.verified ? 'VERIFIED' : 'GUEST';
      const username = profile.verified ? profile.robloxUsername : profile.username;
      $('#homeSubtitle').textContent = mode === 'offline' ? 'Your profile is unavailable while the backend is offline.' : username ? `Playing as @${username}. Find a server and make yourself at home.` : 'Your place to meet up and find your next server.';
    } else {
      $('#guestName').value = profile.name || '';
      $('#guestUsername').value = profile.username || '';
      $('#saveGuest').disabled = mode !== 'live' && mode !== 'demo';
      $('#accountError').textContent = mode === 'offline' ? 'The backend is unavailable. Please try again later.' : '';
      $('#testModeNotice').hidden = !(verification.enabled && verification.testMode);
    }
  }
  async function boot() {
    try {
      const response = await fetch(apiBase + '/api/config', { cache: 'no-store' });
      if (response.status === 404 && !apiBase) { mode = 'demo'; profile = localProfile(); }
      else {
        if (!response.ok) throw new Error('Backend unavailable');
        const config = await response.json();
        if (config.service !== 'condo-api') throw new Error('Backend unavailable');
        mode = 'live'; verification = config.verification || { enabled: false };
        profile = token ? await api('/api/profile') : { name: '', username: '' };
      }
    } catch (_) { mode = 'offline'; verification = { enabled: false }; }
    render();
    if (document.body.dataset.page === 'login') show(view);
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
      script.onload = resolve; script.onerror = () => reject(new Error('CAPTCHA could not load. Please try again later.'));
      document.head.appendChild(script);
    });
    return scriptPromise;
  }
  function activeButton() { return view === 'one' ? $('#challengeButton') : view === 'two' ? $('#verifyButton') : view === 'recovery' ? $('#recoverButton') : null; }
  function updateButton() {
    const button = activeButton(); if (!button) return;
    button.disabled = !verification.enabled || !captchaToken;
    button.textContent = !verification.enabled ? 'Verification unavailable' : !captchaToken ? 'Complete the CAPTCHA' : view === 'one' ? 'Generate verification phrase' : view === 'two' ? 'Verify account' : 'Sign in with recovery code';
  }
  async function show(next) {
    const sequence = ++viewSequence;
    view = next; $('#authError').textContent = ''; captchaToken = '';
    if (widget !== null && window.turnstile) { try { window.turnstile.remove(widget); } catch (_) {} widget = null; }
    for (const [name, selector] of Object.entries({ one:'#verifyStepOne', two:'#verifyStepTwo', recovery:'#recoverySection', success:'#verifiedSection', guest:'#guestSection' })) $(selector).hidden = name !== view;
    $('#progressOne').classList.toggle('active', ['one','two','success'].includes(view));
    $('#progressTwo').classList.toggle('active', ['two','success'].includes(view));
    $('#progressThree').classList.toggle('active', view === 'success');
    const container = view === 'one' ? $('#captchaOne') : view === 'two' ? $('#captchaTwo') : view === 'recovery' ? $('#captchaRecovery') : null;
    updateButton();
    if (!container) return;
    if (!verification.enabled) { container.textContent = mode === 'connecting' ? 'Checking verification availability…' : 'Roblox verification is unavailable until CAPTCHA is configured.'; return; }
    container.textContent = 'Loading CAPTCHA…';
    try {
      await loadTurnstile();
      if (sequence !== viewSequence) return;
      container.textContent = '';
      widget = window.turnstile.render(container, { sitekey: verification.siteKey, theme: 'dark', action: 'roblox_verify', callback: value => { captchaToken = value; updateButton(); }, 'expired-callback': () => { captchaToken = ''; updateButton(); }, 'error-callback': () => { captchaToken = ''; updateButton(); $('#authError').textContent = 'CAPTCHA failed to load. Please try again.'; } });
    } catch (error) { if (sequence === viewSequence) container.textContent = error.message; }
  }
  function resetCaptcha() { captchaToken = ''; updateButton(); if (widget !== null && window.turnstile) { try { window.turnstile.reset(widget); } catch (_) {} } }
  function startTimer(expiresAt) {
    clearInterval(timer);
    const tick = () => { const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)); $('#phraseTimer').textContent = left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'; if (!left) clearInterval(timer); };
    tick(); timer = setInterval(tick, 1000);
  }
  async function copyText(value, button) {
    try { await navigator.clipboard.writeText(value); button.textContent = 'Copied!'; setTimeout(() => { button.textContent = 'Copy'; }, 1800); }
    catch (_) { $('#authError').textContent = 'Copy the text manually.'; }
  }
  function success(result) {
    clearInterval(timer); $('#verifiedName').textContent = '@' + result.robloxUsername;
    $('#recoveryResult').hidden = !result.recoveryCode;
    $('#newRecoveryCode').textContent = result.recoveryCode || '';
    show('success');
  }
  const usernameForm = $('#usernameForm');
  if (usernameForm) {
    usernameForm.addEventListener('submit', async event => {
      event.preventDefault(); const button = $('#challengeButton'); if (button.disabled) return;
      button.disabled = true; $('#authError').textContent = '';
      try {
        await ensureGuest();
        challenge = await api('/api/auth/challenge', { method:'POST', body:{ username:$('#robloxUsername').value.trim(), captchaToken } });
        $('#verifyUsername').textContent = '@' + challenge.user.username;
        $('#verifyAvatar').textContent = challenge.user.username[0].toUpperCase();
        $('#verifyProfileLink').href = `https://www.roblox.com/users/${encodeURIComponent(challenge.user.id)}/profile`;
        $('#verificationPhrase').textContent = challenge.phrase; startTimer(challenge.expiresAt); show('two');
      } catch (error) { $('#authError').textContent = error.message; resetCaptcha(); }
    });
    $('#verifyButton').addEventListener('click', async () => {
      const button = $('#verifyButton'); if (button.disabled || !challenge) return;
      button.disabled = true; $('#authError').textContent = '';
      try { success(await api('/api/auth/verify', { method:'POST', body:{ challengeToken:challenge.challengeToken, captchaToken } })); }
      catch (error) { $('#authError').textContent = error.message; resetCaptcha(); }
    });
    $('#recoverButton').addEventListener('click', async () => {
      const button = $('#recoverButton'); if (button.disabled) return;
      button.disabled = true; $('#authError').textContent = '';
      try { await ensureGuest(); success(await api('/api/auth/recover', { method:'POST', body:{ recoveryCode:$('#recoveryCode').value.trim(), captchaToken } })); }
      catch (error) { $('#authError').textContent = error.message; resetCaptcha(); }
    });
    $('#copyPhrase').addEventListener('click', () => copyText(challenge?.phrase || '', $('#copyPhrase')));
    $('#copyRecovery').addEventListener('click', () => copyText($('#newRecoveryCode').textContent, $('#copyRecovery')));
    $('#newPhrase').addEventListener('click', () => { clearInterval(timer); challenge = null; show('one'); });
    $('#changeUsername').addEventListener('click', () => { clearInterval(timer); challenge = null; show('one'); });
    $('#showRecovery').addEventListener('click', () => show('recovery'));
    $('#backToVerify').addEventListener('click', () => show('one'));
    $('#showGuest').addEventListener('click', () => show('guest'));
    $('#backFromGuest').addEventListener('click', () => show('one'));
  }
  const guestForm = $('#guestForm');
  if (guestForm) guestForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#saveGuest'); if (button.disabled) return;
    const name = $('#guestName').value.trim(), username = $('#guestUsername').value.trim();
    if (name.length < 2) { $('#accountError').textContent = 'Enter a display name with at least 2 characters.'; return; }
    button.disabled = true; $('#accountError').textContent = '';
    try {
      if (mode === 'live') { await ensureGuest(); await api('/api/profile', { method:'PUT', body:{ name, username } }); }
      else if (mode === 'demo') localStorage.setItem('condo-profile', JSON.stringify({ name, username }));
      else throw new Error('The backend is unavailable. Please try again later.');
      location.assign(new URLSearchParams(location.search).get('next') === 'play' ? './' : 'home.html');
    } catch (error) { $('#accountError').textContent = error.message; button.disabled = false; }
  });
  const findForm = $('#findServerForm');
  if (findForm) findForm.addEventListener('submit', event => {
    event.preventDefault(); const id = $('#homeServerId').value.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { $('#homeError').textContent = 'Enter a valid server ID.'; return; }
    const url = new URL('./', location.href); url.searchParams.set('serverid', id); location.assign(url.href);
  });
  boot();
})();
