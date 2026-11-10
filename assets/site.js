// Shared site behaviour: header, embers, live server status.
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString(locale());

// Draco account session (e-mail account, site/lib/masters.mjs): token kept in this browser, shared by every page.
const SESSION_KEY = 'draco.master';
const getToken = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const setToken = v => { try { v ? localStorage.setItem(SESSION_KEY, v) : localStorage.removeItem(SESSION_KEY); } catch {} document.dispatchEvent(new CustomEvent('session')); };
const post = (path, body) => api(path, {method: 'POST', body: JSON.stringify(body)});
/** Player pages API (site/lib/player.mjs): public functions, or the signed-in Draco account's. A 401 ends the session. */
async function x(name, args = {}) {
  try { return await post('/api/x/' + name, {token: getToken() || undefined, args}); }
  catch (error) { if (error.status === 401 && getToken()) setToken(null); throw error; }
}
const signInLink = () => `<a class="btn gold" href="compte.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.hash)}">${esc(t('acc.login'))}</a>`;
const dateFmt = (ms, time = false) => ms ? new Date(Number(ms)).toLocaleString(locale(), time ? {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'} : {day: 'numeric', month: 'long', year: 'numeric'}) : '';
const spinner = () => `<p class="empty">${esc(t('loading'))}</p>`;
const errorBox = e => `<div class="alert error">${esc(e?.status === 404 || e?.status === 405 ? t('x.soon') : e?.message || t('x.error'))}</div>`;

// Light / dark theme (saved in this browser), applied as early as possible.
const getTheme = () => { try { return localStorage.getItem('draco.theme') || 'dark'; } catch { return 'dark'; } };
function setTheme(theme) { document.documentElement.dataset.theme = theme; try { localStorage.setItem('draco.theme', theme); } catch {} const b = document.querySelector('.theme-btn .ms'); if (b) b.textContent = theme === 'light' ? 'dark_mode' : 'light_mode'; }
document.documentElement.dataset.theme = getTheme();

// Launcher-style app bar: icon tabs with labels (labels hide on narrower screens, burger menu on phones).
const NAV = [
  ['index', './', 'home', 'nav.home'], ['telechargement', 'telechargement.html', 'download', 'nav.download'],
  ['classement', 'classement.html', 'leaderboard', 'nav.ladder'], ['encyclopedie', 'encyclopedie.html', 'menu_book', 'nav.wiki'],
  ['boutique', 'boutique.html', 'shopping_cart', 'nav.shop'], ['bourse', 'boutique.html#kamas', 'currency_exchange', 'nav.exchange'],
  ['vote', 'compte.html#recompenses', 'how_to_vote', 'nav.vote'], ['evenements', 'evenements.html', 'celebration', 'nav.events'],
  ['actualites', 'actualites.html', 'newspaper', 'nav.news'], ['aide', 'aide.html', 'help', 'nav.faq'],
];
function header(active) {
  document.body.insertAdjacentHTML('afterbegin', `<div class="bg"></div><canvas class="embers"></canvas>
  <header class="top"><div class="bar">
    <a class="brand" href="./" aria-label="Draco Retro"><img src="assets/logo-icon.png" alt=""><span>DRACO</span></a>
    <button class="burger" aria-label="Menu"><span class="ms">menu</span></button>
    <nav class="nav">
      <div class="tabs-nav">${NAV.map(([key, href, icon, label]) => `<a href="${href}" class="tab-link ${key === active ? 'active' : ''}" data-tip="${label}"><span class="ms">${icon}</span><span class="tab-label" data-i18n="${label}"></span></a>`).join('')}</div>
      <div class="bar-right">
        <button class="icon-btn theme-btn" type="button" data-tip="nav.theme"><span class="ms">${getTheme() === 'light' ? 'dark_mode' : 'light_mode'}</span></button>
        <label class="langpick"><span class="ms">language</span><select aria-label="Langue">${Object.entries(LANGS).map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
        <span class="nav-account"></span>
      </div>
    </nav>
  </div></header>`);
  const account = () => {
    $('.nav-account').innerHTML = getToken()
      ? `<a class="btn gold nav-cta ${active === 'compte' ? 'on' : ''}" href="compte.html"><span class="ms">person</span>${esc(t('nav.account'))}</a>`
      : `<a class="btn nav-cta ghost" href="compte.html"><span class="ms">login</span>${esc(t('nav.signin'))}</a><a class="btn gold nav-cta" href="inscription.html">${esc(t('nav.register'))}</a>`;
  };
  const tips = () => document.querySelectorAll('[data-tip]').forEach(a => { a.title = t(a.dataset.tip); });
  account(); tips();
  document.addEventListener('session', account);
  $('.burger').onclick = () => $('.nav').classList.toggle('open');
  $('.theme-btn').onclick = () => setTheme(getTheme() === 'light' ? 'dark' : 'light');
  const pick = $('.langpick select'); pick.value = LANG; pick.onchange = () => setLang(pick.value);
  applyI18n();
  document.addEventListener('langchange', () => { account(); tips(); if (lastStatus) renderStatus(lastStatus); });
  document.body.insertAdjacentHTML('beforeend', `<footer><div class="wrap">
    <div><a class="brand" href="./"><img src="assets/logo-icon.png" alt="">DRACO RETRO</a></div>
    <div class="fine" data-i18n="foot.fine"></div>
    <div class="foot-links">${getToken() ? '' : '<a href="inscription.html" data-i18n="nav.register"></a> · '}<a href="telechargement.html" data-i18n="nav.download"></a> · <a href="classement.html" data-i18n="nav.ladder"></a> · <a href="encyclopedie.html" data-i18n="nav.wiki"></a> · <a href="evenements.html" data-i18n="nav.events"></a> · <a href="compte.html#recompenses" data-i18n="nav.vote"></a> · <a href="reglement.html" data-i18n="nav.rules"></a> · <a href="aide.html" data-i18n="nav.faq"></a><span id="footDiscord" hidden> · <a target="_blank" rel="noopener" data-i18n="foot.discord"></a></span></div>
  </div></footer>`);
  applyI18n($('footer'));
  embers();
  loadSiteFeed();
}

// Running event (banner under the header) and Discord link, from the site API.
let siteFeed = null;
function renderSiteFeed() {
  if (!siteFeed) return;
  document.querySelector('.event-banner')?.remove();
  const ev = siteFeed.event;
  if (ev && ev.until > Date.now()) document.querySelector('header.top').insertAdjacentHTML('afterend', `<div class="event-banner">${esc(t('event.banner', {label: ev.label, date: new Date(ev.until).toLocaleString(locale(), {weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'})}))}</div>`);
  const d = $('#footDiscord'); if (d && siteFeed.discord) { d.hidden = false; d.querySelector('a').href = siteFeed.discord; }
  document.dispatchEvent(new CustomEvent('sitefeed', {detail: siteFeed}));
}
async function loadSiteFeed() { try { siteFeed = await api('/api/feed'); renderSiteFeed(); } catch {} }
document.addEventListener('langchange', renderSiteFeed);

function embers() {
  const c = $('canvas.embers'); if (!c) return;
  const ctx = c.getContext('2d'); let w, h; const dpr = Math.min(2, devicePixelRatio || 1);
  const resize = () => { w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr; };
  addEventListener('resize', resize); resize();
  const spawn = () => ({x: Math.random() * w, y: h + Math.random() * h * .3, r: (Math.random() * 1.7 + .5) * dpr, vy: (Math.random() * .6 + .2) * dpr, vx: (Math.random() - .5) * .3, life: 0, max: 400 + Math.random() * 500, hue: 18 + Math.random() * 26});
  const parts = Array.from({length: innerWidth < 700 ? 30 : 60}, () => { const p = spawn(); p.y = Math.random() * h; return p; });
  let last = 0;
  (function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return; last = t;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.life++; p.y -= p.vy; p.x += p.vx + Math.sin((p.life + p.max) / 40) * .25;
      const a = Math.min(1, p.life / 60) * Math.max(0, 1 - p.life / p.max);
      ctx.beginPath(); ctx.fillStyle = `hsla(${p.hue},95%,60%,${a * .8})`; ctx.shadowColor = `hsla(${p.hue},100%,55%,${a})`; ctx.shadowBlur = 8 * dpr;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.life > p.max || p.y < -10) Object.assign(p, spawn());
    }
  })(0);
}

// API address: same origin on the server, the public tunnel when the pages are hosted on GitHub Pages.
let apiBase = null;
async function apiOrigin() {
  if (apiBase !== null) return apiBase;
  try { apiBase = String((await (await fetch('config.json', {cache: 'no-store'})).json()).apiUrl || '').replace(/\/$/, ''); } catch { apiBase = ''; }
  return apiBase;
}
const absolute = url => /^https?:\/\//.test(url);
async function apiUrl(path) { return absolute(path) ? path : (await apiOrigin()) + path; }
async function api(path, options = {}) {
  const res = await fetch(await apiUrl(path), {...options, headers: {accept: 'application/json', ...(options.body ? {'content-type': 'application/json'} : {})}});
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(trServer(body?.message) || t('err.http', {s: res.status})), {errors: body?.errors, status: res.status});
  return body;
}

let lastStatus = null;
function renderStatus(s) {
  document.querySelectorAll('[data-status]').forEach(el => {
    const key = el.dataset.status;
    if (key === 'state') el.innerHTML = s.error ? `<span class="dot off"></span>${esc(t('st.unavailable'))}` : `<span class="dot ${s.ready ? 'on' : 'off'}"></span>${esc(t(s.ready ? 'st.online' : 'st.offline'))}`;
    else if (s.error) return;
    else if (key.startsWith('rate.')) el.textContent = 'x' + (s.rates?.[key.slice(5)] ?? 1);
    else el.textContent = key === 'name' ? s.name : fmt(s[key]);
  });
}
async function liveStatus() {
  try { lastStatus = await api('/api/status'); } catch { lastStatus = {error: true}; }
  renderStatus(lastStatus);
  return lastStatus.error ? null : lastStatus;
}
const classImg = (id, sex) => `assets/class-${Number(id) || 1}_${Number(sex) ? 1 : 0}.png`;

// Images exported from the game client (tools/game-images.py): item icons, monster and class illustrations.
let gameImagesPromise = null;
const GAME_IMAGES = {items: {}, monsters: {}};
function gameImages() {
  return gameImagesPromise ||= Promise.all(['item-icons', 'monster-gfx'].map(f => fetch(`assets/${f}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))))
    .then(([items, monsters]) => Object.assign(GAME_IMAGES, {items, monsters}));
}
/** <img> of an item icon (by item template id), or a neutral placeholder when the game has no picture for it. */
function itemIcon(id, size = 40) {
  const g = GAME_IMAGES.items[id];
  return g ? `<img class="gi" src="img/items/${g}.webp" alt="" width="${size}" height="${size}" loading="lazy">` : `<span class="gi gi-none" style="width:${size}px;height:${size}px"><span class="ms">category</span></span>`;
}
function monsterImg(id, size = 40, cls = '') {
  const g = GAME_IMAGES.monsters[id];
  return g ? `<img class="gi ${cls}" src="img/monsters/${g}.webp" alt="" style="max-width:${size}px;max-height:${size}px" loading="lazy">` : `<span class="gi gi-none ${cls}" style="width:${size}px;height:${size}px"><span class="ms">pets</span></span>`;
}
const classArt = (id, sex) => `img/classes/${Number(id) || 1}_${Number(sex) ? 1 : 0}.webp`;
