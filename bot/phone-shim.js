// Bot Draco on the phone, from the Draco site (site/public/bot/, built by tools/bot-extension.mjs): the very page of the
// bot app (app.js), whose requests to its own server (/api/…) and live stream (EventSource /api/events) are carried
// by the site relay to the Bot Draco extension running on the player's PC (site/lib/bot-relay.mjs, relay.mjs).
// Signed in with the Draco account of the site (same token as the other pages: localStorage "draco.master").
(() => {
  const KEY = 'draco.master';
  const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const setToken = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} };
  const nativeFetch = window.fetch.bind(window);
  let base = null;
  async function apiBase() {
    if (base !== null) return base;
    try { base = String((await (await nativeFetch('../config.json', {cache: 'no-store'})).json()).apiUrl || '').replace(/\/$/, ''); } catch { base = ''; }
    return base;
  }
  async function site(route, body = {}, signal) {
    const res = await nativeFetch((await apiBase()) + route, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: getToken(), ...body}), signal});
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && route !== '/api/master/login') { setToken(null); location.reload(); }
    if (!res.ok) throw Object.assign(Error(data?.message || `erreur ${res.status}`), {status: res.status});
    return data;
  }
  const reply = (status, body) => new Response(JSON.stringify(body ?? {}), {status, headers: {'content-type': 'application/json'}});

  // --- Requests of app.js --------------------------------------------------------------------------------------------
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return nativeFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body;
    try { body = init.body ? JSON.parse(init.body) : undefined; } catch {}
    if (url === '/api/login') {
      try { const r = await site('/api/master/login', {email: body?.email, password: body?.password}); setToken(r.token); return reply(200, {ok: true}); }
      catch (e) { return reply(401, {error: e.message}); }
    }
    if (url === '/api/logout') { await site('/api/master/logout').catch(() => {}); setToken(null); return reply(200, {ok: true}); }
    if (!getToken()) return url === '/api/info' ? reply(200, {authorized: false}) : reply(401, {error: 'connexion requise'});
    try {
      const r = await site('/api/bot/relay/call', {method, path: url, ...(body !== undefined ? {body} : {})});
      return reply(r.status, r.body);
    } catch (e) {
      if (e.status === 503) offline(e.message);
      // PC off: the page still opens (banner + retries) instead of the sign-in screen
      if (url === '/api/info' && (e.status === 503 || e.status === 504)) return reply(200, {authorized: true, local: false, admin: true, master: null, addresses: [], offline: true});
      return reply(e.status || 502, {error: e.message});
    }
  };

  // --- Live stream: long polling of the site instead of Server-Sent Events -------------------------------------------
  class RelayEventSource {
    constructor() {
      this.listeners = new Map();
      this.closed = false;
      this.run();
    }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    emit(type, data) { for (const fn of this.listeners.get(type) || []) { try { fn({type, data}); } catch (e) { console.error(e); } } }
    close() { this.closed = true; this.abort?.abort(); }
    async hello() {
      const r = await site('/api/bot/relay/call', {method: 'GET', path: '/api/hello'});
      if (r.status !== 200) throw Object.assign(Error(r.body?.error || 'le PC ne répond pas'), {status: r.status});
      this.emit('hello', JSON.stringify(r.body));
    }
    async run() {
      let seq = null, failures = 0;
      while (!this.closed) {
        try {
          this.abort = new AbortController();
          if (seq === null) {
            seq = (await site('/api/bot/relay/events', {since: -1}, this.abort.signal)).seq; // where the stream stands now
            await this.hello();
          }
          const r = await site('/api/bot/relay/events', {since: seq}, this.abort.signal);
          failures = 0;
          if (r.online === false) offline(); else online();
          if (r.reset) { seq = null; continue; }
          for (const e of r.events) this.emit(e.type, e.data);
          seq = r.seq;
        } catch (e) {
          if (this.closed) return;
          if (e.status === 503 || e.status === 504) offline(e.message);
          seq = null;
          await new Promise(res => setTimeout(res, Math.min(15000, 1500 * 2 ** Math.min(failures++, 3))));
        }
      }
    }
  }
  window.EventSource = RelayEventSource;

  // --- "Your PC is not reachable" banner ------------------------------------------------------------------------------
  let banner = null;
  function offline(text) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'relay-offline';
      banner.innerHTML = '<span class="ms">cloud_off</span><span class="t"></span><button class="btn" type="button">Réessayer</button>';
      banner.querySelector('button').onclick = () => location.reload();
      document.body.prepend(banner);
    }
    banner.querySelector('.t').textContent = text || 'Ton PC n\'est pas joignable : ouvre le launcher Draco sur ton PC et lance le Bot Draco (onglet Extensions).';
    banner.hidden = false;
  }
  function online() { if (banner) banner.hidden = true; }
  document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) return;
    try { const s = await site('/api/bot/relay/status'); if (!s.online) offline(); } catch {}
  });
})();
