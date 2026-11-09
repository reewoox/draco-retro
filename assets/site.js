// Shared site behaviour: header, embers, live server status.
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('fr-FR');

function header(active) {
  const links = [['index', './', 'Accueil'], ['telechargement', 'telechargement.html', 'Télécharger'], ['classement', 'classement.html', 'Classement']];
  document.body.insertAdjacentHTML('afterbegin', `<div class="bg"></div><canvas class="embers"></canvas>
  <header class="top"><div class="wrap">
    <a class="brand" href="./"><img src="assets/logo-icon.png" alt="">DRACO</a>
    <button class="burger" aria-label="Menu">☰</button>
    <nav class="nav">${links.map(([key, href, label]) => `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('')}
      <a class="btn gold nav-cta" href="inscription.html">Créer un compte</a></nav>
  </div></header>`);
  $('.burger').onclick = () => $('.nav').classList.toggle('open');
  document.body.insertAdjacentHTML('beforeend', `<footer><div class="wrap">
    <div><a class="brand" href="./"><img src="assets/logo-icon.png" alt="">DRACO RETRO</a></div>
    <div class="fine">Serveur privé non officiel. Dofus est une marque d'Ankama Games ; ce site n'est ni affilié ni approuvé par Ankama.</div>
    <div><a href="inscription.html">Créer un compte</a> · <a href="telechargement.html">Télécharger</a> · <a href="classement.html">Classement</a></div>
  </div></footer>`);
  embers();
}

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
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Erreur ' + res.status), {errors: body?.errors, status: res.status});
  return body;
}

async function liveStatus() {
  try {
    const s = await api('/api/status');
    document.querySelectorAll('[data-status]').forEach(el => {
      const key = el.dataset.status;
      if (key === 'state') el.innerHTML = `<span class="dot ${s.ready ? 'on' : 'off'}"></span>${s.ready ? 'En ligne' : 'Hors ligne'}`;
      else if (key.startsWith('rate.')) el.textContent = 'x' + (s.rates?.[key.slice(5)] ?? 1);
      else el.textContent = key === 'name' ? s.name : fmt(s[key]);
    });
    return s;
  } catch { document.querySelectorAll('[data-status="state"]').forEach(el => el.innerHTML = '<span class="dot off"></span>Indisponible'); }
}
const classImg = (id, sex) => `assets/class-${Number(id) || 1}_${Number(sex) ? 1 : 0}.png`;
