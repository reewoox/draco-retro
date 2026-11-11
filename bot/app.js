// Bot Draco — page de contrôle. L'état des bots arrive en direct (Server-Sent Events, /api/events) ; les commandes
// partent vers /api/bots/<compte>/<commande>. Les cartes sont dessinées en SVG à partir des cases que le serveur du
// bot décode des scripts du jeu (/api/map/<id>).
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => (n === null || n === undefined || Number.isNaN(n) ? '–' : Math.round(Number(n)).toLocaleString('fr-FR'));
const clock = t => new Date(t).toLocaleTimeString('fr-FR', {hour12: false});
const CLASS_NAMES = {1: 'Féca', 2: 'Osamodas', 3: 'Enutrof', 4: 'Sram', 5: 'Xélor', 6: 'Ecaflip', 7: 'Eniripsa', 8: 'Iop', 9: 'Crâ', 10: 'Sadida', 11: 'Sacrieur', 12: 'Pandawa'};
const CLASS_KEYS = ['feca', 'osamodas', 'enutrof', 'sram', 'xelor', 'ecaflip', 'eniripsa', 'iop', 'cra', 'sadida', 'sacrieur', 'pandawa'];
const STATUS = {connexion: 'Connexion', chasse: 'Chasse', trajet: 'En route', combat: 'Combat', repos: 'Repos', vente: 'Vente HDV', pause: 'En pause', 'arrêté': 'Arrêté', erreur: 'Erreur'};
const statusClass = s => 'st-' + ({'arrêté': 'arrete'}[s] || s || 'connexion');
const TABS = [['direct', 'live_tv', 'Direct'], ['carte', 'map', 'Carte'], ['combat', 'swords', 'Combat'], ['inventaire', 'backpack', 'Sac'], ['journal', 'receipt_long', 'Journal'], ['bilan', 'monitoring', 'Bilan'], ['reglages', 'tune', 'Réglages']];

const store = {info: null, bots: new Map(), selected: null, tab: 'direct', maps: new Map(), around: new Map(), gfx: {}, icons: {}, types: {}, accounts: null, history: null, drawn: {}, invFilter: 'all'};
const itemIcon = template => (store.icons[template] ? `../img/items/${store.icons[template]}.webp` : '');
const kamas = n => `${fmt(n)} k`;

// --- Helpers ----------------------------------------------------------------------------------------------------------
async function api(path, {method = 'GET', body} = {}) {
  const res = await fetch(path, {method, credentials: 'same-origin', headers: body !== undefined ? {'Content-Type': 'application/json'} : {}, body: body !== undefined ? JSON.stringify(body) : undefined});
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw Error('connexion requise'); }
  if (!res.ok) throw Error(data?.error || `erreur ${res.status}`);
  return data;
}
function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}
const classOf = gfx => (gfx ? [Math.floor(gfx / 10), gfx % 10] : [null, 0]);
const classIcon = (classId, sex = 0) => (classId ? `../assets/class-${classId}_${sex ? 1 : 0}.png` : '');
const monsterImg = template => (store.gfx[template] ? `../img/monsters/${store.gfx[template]}.webp` : '');
const lifePct = (life, max) => (max > 0 ? Math.max(0, Math.min(100, (life / max) * 100)) : 0);
const current = () => store.bots.get(store.selected);
/** The character's name: the state's, else the start line of its log ("En jeu avec …"), else the account. */
function nameOf(b) {
  const s = b?.state || {};
  if (typeof s.character === 'string' && s.character) return s.character;
  if (typeof b?.meta?.character === 'string' && b.meta.character) return b.meta.character;
  const line = [...(b?.logs || [])].reverse().find(l => /^En jeu avec /.test(l.text));
  return (line && /^En jeu avec (\S+)/.exec(line.text)?.[1]) || b?.meta?.account || 'Bot';
}
/** Character sheet (stats, spells, gear): "sheet", or "character" for a bot started before 2026-11-11 12:00. */
const sheetOf = s => s?.sheet || (s?.character && typeof s.character === 'object' ? s.character : null);
function duration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

// --- Start ------------------------------------------------------------------------------------------------------------
async function boot() {
  try { store.info = await fetch('/api/info', {credentials: 'same-origin'}).then(r => r.json()); }
  catch { document.body.textContent = "Impossible de joindre l'application du bot."; return; }
  if (!store.info.authorized) return showLogin();
  showApp();
}
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  setTimeout(() => $('#login-password').focus(), 50);
}
async function signIn(body) {
  const err = $('#login-error');
  err.hidden = true;
  try {
    await api('/api/login', {method: 'POST', body});
    store.info = await fetch('/api/info', {credentials: 'same-origin'}).then(r => r.json());
    showApp();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
}
$('#login-form').addEventListener('submit', e => { e.preventDefault(); signIn({password: $('#login-password').value}); });
$('#login-draco').addEventListener('submit', e => { e.preventDefault(); signIn({email: $('#login-email').value, password: $('#login-draco-password').value}); });
async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#btn-accounts').hidden = $('#btn-phone').hidden = !store.info.local;
  if (store.info.extension) $('#btn-accounts').hidden = true; // launcher extension: game accounts are managed on the site
  $('#btn-logout').hidden = store.info.local;
  // This PC can add the game accounts of a Draco account; a phone signed in with one shows whose they are.
  $('#btn-draco').hidden = !(store.info.local || store.info.master);
  $('#btn-draco-label').textContent = store.info.master ? store.info.master.email : 'Compte Draco';
  [store.gfx, store.icons, store.types] = await Promise.all([
    api('/api/monster-gfx').catch(() => ({})),
    fetch('../assets/item-icons.json').then(r => r.json()).catch(() => ({})),
    api('/api/item-types').catch(() => ({})),
  ]);
  connect();
  render();
}
$('#btn-logout').addEventListener('click', async () => { await api('/api/logout', {method: 'POST', body: {}}).catch(() => {}); location.reload(); });

let source;
function connect() {
  source?.close();
  source = new EventSource('/api/events');
  source.addEventListener('hello', e => {
    const {bots} = JSON.parse(e.data);
    store.bots = new Map(bots.map(b => [b.key, {meta: b, state: b.state, logs: b.logs || [], inventory: b.inventory, xp: []}]));
    if (!store.selected || !store.bots.has(store.selected)) store.selected = bots.find(b => b.running)?.key || bots[0]?.key || null;
    render();
  });
  source.addEventListener('bot', e => {
    const m = JSON.parse(e.data);
    const b = store.bots.get(m.key) || {meta: m, state: null, logs: [], inventory: null, xp: []};
    const added = !store.bots.has(m.key);
    b.meta = m;
    store.bots.set(m.key, b);
    if (added && (!store.selected || store.pendingSelect === m.key)) { store.selected = m.key; store.pendingSelect = null; render(); return; }
    schedule();
  });
  source.addEventListener('state', e => {
    const {key, state} = JSON.parse(e.data);
    const b = store.bots.get(key);
    if (!b) return;
    b.state = state;
    if (state.fight?.now) state.fight.skew = Date.now() - state.fight.now; // phone and PC clocks may differ
    const xp = state.summary?.xp;
    if (xp !== undefined && (!b.xp.length || b.xp[b.xp.length - 1].xp !== xp)) { b.xp.push({t: Date.now(), xp}); if (b.xp.length > 400) b.xp.shift(); }
    schedule();
  });
  source.addEventListener('log', e => {
    const {key, line} = JSON.parse(e.data);
    const b = store.bots.get(key);
    if (!b) return;
    b.logs.push(line);
    if (b.logs.length > 500) b.logs.shift();
    if (key === store.selected && store.tab === 'journal') appendLog(line);
  });
  source.addEventListener('alert', e => showAlert(JSON.parse(e.data)));
  source.addEventListener('inventory', e => {
    const {key, inventory} = JSON.parse(e.data);
    const b = store.bots.get(key);
    if (!b) return;
    b.inventory = inventory;
    if (key === store.selected && store.tab === 'inventaire') updateInventory(b);
  });
  source.addEventListener('removed', e => {
    const {key} = JSON.parse(e.data);
    store.bots.delete(key);
    if (store.selected === key) store.selected = store.bots.keys().next().value || null;
    render();
  });
  source.addEventListener('history', () => { store.history = null; if (store.tab === 'bilan') loadHistory(); });
}

// --- Alerts (chosen on each device: this PC, a phone…) -----------------------------------------------------------------
const ALERT_KINDS = [['defaite', 'Défaite'], ['niveau', 'Niveau (son et notification tous les 10)'], ['vente', 'Objet vendu'], ['probleme', 'Problème (déconnexion, erreur)'], ['arret', 'Fin de session'], ['hdv', 'Mise en vente à l\'HDV']];
function alertPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('dbot-alerts') || '{}'); } catch {}
  return {events: {defaite: true, niveau: true, vente: true, probleme: true, arret: true, hdv: true, ...(saved.events || {})}, sound: !!saved.sound, desktop: !!saved.desktop};
}
function saveAlertPrefs(prefs) { try { localStorage.setItem('dbot-alerts', JSON.stringify(prefs)); } catch {} }
let audio = null;
function beep(bad) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = bad ? 330 : 660;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (bad ? 0.4 : 0.15));
  } catch {}
}
function showAlert(a) {
  const prefs = alertPrefs();
  if (!prefs.events[a.kind]) return;
  const who = typeof a.character === 'string' ? a.character : nameOf(store.bots.get(a.key));
  const text = `${who} : ${a.text}`, bad = a.kind === 'defaite' || a.kind === 'probleme';
  toast(text, bad);
  if (a.kind === 'niveau' && a.level % 10 !== 0) return; // a toast for every level, more only every 10
  if (prefs.sound) beep(bad);
  if (bad && navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch {} }
  if (prefs.desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) { try { new Notification('Bot Draco', {body: text}); } catch {} }
}

let frame = 0;
function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; renderList(); updateDetail(); });
}

// --- Bot list ---------------------------------------------------------------------------------------------------------
function botStatus(b) {
  if (!b.meta.running) return b.meta.error ? 'erreur' : 'arrêté';
  return b.state?.status || 'connexion';
}
function renderList() {
  const el = $('#bots');
  const bots = [...store.bots.values()];
  el.innerHTML = `<div class="bots-title"><h2>Bots (${bots.filter(b => b.meta.running).length} actif${bots.filter(b => b.meta.running).length > 1 ? 's' : ''})</h2></div>` + bots.map(b => {
    const s = b.state || {}, st = botStatus(b), [cls, sex] = classOf(s.gfx);
    const where = s.map ? `[${s.map.x},${s.map.y}]` : '';
    return `<button class="bot-card${b.meta.key === store.selected ? ' selected' : ''}" data-key="${esc(b.meta.key)}">
      <div class="avatar">${cls ? `<img src="${classIcon(cls, sex)}" alt="">` : '<span class="ms">smart_toy</span>'}</div>
      <div style="min-width:0">
        <div class="name"><b>${esc(nameOf(b))}</b><span class="pill ${statusClass(st)}">${STATUS[st] || st}</span></div>
        <div class="line2">${s.level ? `Niv. ${s.level} · ` : ''}${where}${s.maxLife ? ` · ${fmt(s.life)}/${fmt(s.maxLife)} PV` : ''}</div>
        <div class="bar"><i style="width:${lifePct(s.life, s.maxLife)}%"></i></div>
      </div>
    </button>`;
  }).join('');
}
$('#bots').addEventListener('click', e => {
  const card = e.target.closest('.bot-card');
  if (!card || card.dataset.key === store.selected) return;
  store.selected = card.dataset.key;
  render();
});

// --- Detail -----------------------------------------------------------------------------------------------------------
function render() { renderList(); renderDetail(); }

function renderDetail() {
  const el = $('#detail');
  store.drawn = {};
  const b = current();
  if (!b) {
    el.innerHTML = `<div class="panel empty"><span class="ms">smart_toy</span><h2>Aucun bot lancé</h2>
      <p>Lance un bot sur un de tes comptes : il cherche des monstres à sa mesure, se bat et se déplace tout seul de carte en carte.</p>
      <button class="btn primary" data-action="new"><span class="ms">add</span>Nouveau bot</button></div>`;
    return;
  }
  el.innerHTML = `<section class="panel hero" id="hero"></section>
    <nav class="panel tabs" id="tabs">${TABS.map(([id, icon, label]) => `<button data-tab="${id}" class="${store.tab === id ? 'on' : ''}"><span class="ms">${icon}</span>${label}<span class="badge" data-badge="${id}" hidden></span></button>`).join('')}</nav>
    <div id="tab"></div>`;
  renderTab();
  updateDetail();
}

function renderTab() {
  const el = $('#tab');
  store.drawn = {};
  if (store.tab === 'direct') {
    el.innerHTML = `<div class="tab grid-2 live">
      <div class="panel mapbox live-box"><div class="maphead"><b id="live-title">Direct</b><span class="muted" id="live-sub"></span></div>
        <div id="live-svg" class="live-svg"></div>
        <div class="live-caption" id="live-caption"></div></div>
      <div class="tab">
        <div class="panel card"><h3>Ce qu'il pense</h3><div id="live-think" class="think"></div></div>
        <div class="panel card"><h3>En direct <span class="muted" id="feed-meta"></span></h3><div id="live-feed" class="feed2"></div></div>
      </div></div>`;
  } else if (store.tab === 'carte') {
    el.innerHTML = `<div class="tab grid-2">
      <div class="panel mapbox"><div class="maphead"><b id="map-title">Carte</b><span class="muted" id="map-sub"></span></div><div id="map-svg"></div>
        <div class="legend"><span><i style="background:var(--gold)"></i>le bot</span><span><i style="background:var(--bad)"></i>groupe attaquable</span><span><i style="background:#77706a"></i>groupe ignoré</span><span><i style="background:rgba(230,176,74,.55)"></i>changement de carte</span><span><i style="background:#5a4026"></i>objet (arbre, minerai…)</span><span><i style="background:var(--obstacle)"></i>obstacle</span></div></div>
      <div class="tab">
        <div class="panel card"><h3>Groupes sur la carte <span class="muted" id="groups-meta"></span></h3><div class="groups" id="groups"></div></div>
        <div class="panel card"><h3>Trajet <span class="muted" id="route-meta"></span></h3><div class="route" id="route"></div>
          <svg class="world" id="world" style="margin-top:12px"></svg><p class="hint">Touche une carte pour y envoyer le bot.</p></div>
      </div></div>`;
  } else if (store.tab === 'combat') {
    el.innerHTML = `<div class="tab" id="fight-wrap"></div>`;
  } else if (store.tab === 'journal') {
    el.innerHTML = `<div class="panel log" id="log"></div>`;
    const log = $('#log');
    log.innerHTML = (current()?.logs || []).map(logLine).join('');
    log.scrollTop = log.scrollHeight;
  } else if (store.tab === 'bilan') {
    el.innerHTML = `<div class="tab"><div class="panel card"><h3>Cette session</h3><div class="tiles" id="tiles"></div></div>
      <div class="panel card"><h3>Sessions précédentes</h3><div class="scroll-x" id="history"><p class="muted">Chargement…</p></div></div></div>`;
    loadHistory();
  } else if (store.tab === 'inventaire') {
    const filters = [['all', 'Tout'], ['sell', 'À vendre'], ['equip', 'Équipés'], ['heal', 'Soins'], ['keep', 'Gardés']];
    el.innerHTML = `<div class="tab grid-2">
      <div class="panel card"><h3>Sac <span class="muted" id="inv-meta"></span></h3>
        <div class="chips" id="inv-filters">${filters.map(([id, label]) => `<button class="chip${store.invFilter === id ? ' on' : ''}" data-filter="${id}">${label}</button>`).join('')}</div>
        <div class="items" id="items"><p class="muted">En attente de l'inventaire du bot…</p></div>
        <p class="hint">Touche un objet pour qu'il ne soit jamais vendu (ou pour le remettre en vente).</p></div>
      <div class="tab">
        <div class="panel card"><h3>Personnage <span class="muted" id="char-meta"></span></h3><div id="char"><p class="muted" style="margin:0">En attente…</p></div></div>
        <div class="panel card"><h3>Hôtel de vente <span class="muted" id="hdv-meta"></span></h3>
          <div class="row"><button class="btn primary" data-action="sell" id="sell-btn"><span class="ms">sell</span>Vendre maintenant</button></div>
          <p class="hint" id="hdv-next"></p><div class="list compact" id="listings"></div></div>
        <div class="panel card"><h3>Ventes <span class="muted" id="sales-meta"></span></h3><div class="list compact" id="sales"></div></div>
      </div></div>`;
    $('#inv-filters').addEventListener('click', e => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      store.invFilter = chip.dataset.filter;
      $('#inv-filters').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === chip));
      updateInventory(current());
    });
    $('#items').addEventListener('click', e => { const card = e.target.closest('[data-template]'); if (card) toggleKeep(Number(card.dataset.template)); });
    updateInventory(current());
  } else if (store.tab === 'reglages') {
    renderSettings(el);
  }
}

// --- Bag and auction house ----------------------------------------------------------------------------------------------
function updateInventory(b) {
  const el = $('#items');
  if (!el || !b) return;
  const inv = b.inventory;
  if (!inv) return;
  const items = inv.items;
  const value = items.reduce((v, it) => v + (it.sell ? it.unit * it.qty : 0), 0);
  $('#inv-meta').textContent = `${items.length} objet(s) · ${items.filter(it => it.sell).length} à vendre · ~${kamas(value)}`;
  const pick = {all: () => true, sell: it => it.sell, equip: it => it.pos !== -1, heal: it => it.heal > 0, keep: it => it.keep}[store.invFilter] || (() => true);
  const shown = items.filter(pick).sort((a, c) => (c.pos !== -1) - (a.pos !== -1) || c.unit * c.qty - a.unit * a.qty);
  el.innerHTML = shown.length ? shown.map(it => {
    const icon = itemIcon(it.template), tags = [];
    if (it.pos !== -1) tags.push('<span class="tag eq">équipé</span>');
    if (it.heal) tags.push(`<span class="tag heal">soin +${Math.round(it.heal)}</span>`);
    if (it.linked) tags.push('<span class="tag">lié</span>');
    if (it.keep) tags.push('<span class="tag keep">gardé</span>');
    else if (it.sell) tags.push('<span class="tag sell">à vendre</span>');
    return `<button class="item${it.keep ? ' kept' : ''}" data-template="${it.template}" title="${esc(`${it.name} — ${store.types[it.type] || ''} niveau ${it.level ?? '?'}`)}">
      <span class="ico">${icon ? `<img src="${icon}" alt="" loading="lazy">` : '<span class="ms">inventory_2</span>'}${it.qty > 1 ? `<b class="qty">${fmt(it.qty)}</b>` : ''}</span>
      <span class="iname">${esc(it.name)}</span><span class="iprice">${it.unit ? kamas(it.unit * it.qty) : ''}</span><span class="tags">${tags.join('')}</span></button>`;
  }).join('') : '<p class="muted" style="margin:0">Rien ici.</p>';
  const listings = inv.listings || [];
  $('#hdv-meta').textContent = inv.max ? `${listings.length}/${inv.max} annonces · taxe ${inv.tax} %` : '';
  $('#listings').innerHTML = listings.length ? listings.slice(-60).reverse().map(l => `<div class="item-row">${itemIcon(l.template) ? `<img src="${itemIcon(l.template)}" alt="">` : ''}<span>${esc(l.name)}${l.lot > 1 ? ` <span class="muted">×${l.lot}</span>` : ''}</span><b>${kamas(l.price)}</b></div>`).join('')
    : '<p class="muted" style="margin:0">Aucune annonce pour l\'instant.</p>';
  const sales = inv.sales || [];
  $('#sales-meta').textContent = sales.length ? `${sales.length} · ${kamas(sales.reduce((s, x) => s + x.price, 0))}` : '';
  $('#sales').innerHTML = sales.length ? sales.slice().reverse().map(s => `<div class="item-row">${itemIcon(s.template) ? `<img src="${itemIcon(s.template)}" alt="">` : ''}<span>${esc(s.name)} <span class="muted">${clock(s.time)}</span></span><b class="gold">${kamas(s.price)}</b></div>`).join('')
    : '<p class="muted" style="margin:0">Pas encore de vente.</p>';
  updateMarketInfo(b);
}
const SLOT_LABELS = {0: 'Amulette', 1: 'Arme', 2: 'Anneau', 4: 'Anneau', 3: 'Ceinture', 5: 'Bottes', 6: 'Coiffe', 7: 'Cape', 8: 'Familier', 15: 'Bouclier', 9: 'Dofus', 10: 'Dofus', 11: 'Dofus', 12: 'Dofus', 13: 'Dofus', 14: 'Dofus'};
const STAT_LABELS = {force: 'Force', intelligence: 'Intelligence', chance: 'Chance', agilite: 'Agilité', vitalite: 'Vitalité', sagesse: 'Sagesse'};
function updateCharacter(b) {
  const el = $('#char'), c = sheetOf(b?.state);
  if (!el || !c) return;
  const key = JSON.stringify([c.capital, c.spellPts, c.build, c.stats, c.spells.map(s => [s.level, s.used]), c.equipment.map(e => e.template)]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  $('#char-meta').textContent = `build ${STAT_LABELS[c.build] || c.build}${c.capital ? ` · ${c.capital} point(s) à placer` : ''}${c.spellPts ? ` · ${c.spellPts} point(s) de sort` : ''}`;
  const worn = new Map(c.equipment.map(e => [e.slot, e]));
  const slots = [6, 0, 7, 1, 2, 15, 3, 4, 5, 8];
  el.innerHTML = `<div class="gear">${slots.map(s => { const e = worn.get(s), icon = e && itemIcon(e.template);
      return `<div class="slot${e ? ' on' : ''}" title="${esc(e ? `${SLOT_LABELS[s]} : ${e.name}` : `${SLOT_LABELS[s]} : vide`)}">${icon ? `<img src="${icon}" alt="">` : `<span>${SLOT_LABELS[s]}</span>`}</div>`; }).join('')}</div>
    <div class="caracs">${Object.entries(STAT_LABELS).map(([k, label]) => `<div class="${k === c.build ? 'main' : ''}"><span>${label}</span><b>${fmt(c.stats[k])}</b></div>`).join('')}
      <div><span>PA / PM</span><b>${c.stats.ap} / ${c.stats.mp}</b></div><div><span>Portée</span><b>+${fmt(c.stats.range)}</b></div><div><span>Dommages</span><b>+${fmt(c.stats.damage)}</b></div></div>
    <div class="spells">${c.spells.slice().sort((a, s2) => s2.used - a.used || s2.level - a.level).map(s => `<div><span>${esc(s.name)}</span><i class="lv">${'●'.repeat(s.level)}${'○'.repeat(Math.max(0, 6 - s.level))}</i>${s.used ? `<em>${s.used}×</em>` : '<em></em>'}</div>`).join('')}</div>`;
}
function updateMarketInfo(b) {
  const el = $('#hdv-next');
  if (!el) return;
  const m = b.state?.market, o = b.state?.options || {};
  const last = m?.last ? `Dernier passage ${clock(m.last.time)} : ${m.last.listed} lot(s), ${kamas(m.last.total)} (taxe ${kamas(m.last.taxes)}). ` : '';
  el.textContent = last + (m?.requested ? 'Vente demandée.' : o.autoSell ? `Vente automatique dans ${m?.nextSell ?? '?'} combat(s).` : 'Vente automatique désactivée (onglet Réglages).');
  const btn = $('#sell-btn');
  if (btn) btn.disabled = !b.meta.running || !!m?.requested;
}
async function toggleKeep(template) {
  const b = current();
  if (!b?.meta.running || !b.state) return toast('Le bot doit tourner pour changer ce réglage.', true);
  const keep = new Set(b.state.options?.keep || []);
  const name = b.inventory?.items.find(it => it.template === template)?.name || `objet ${template}`;
  if (keep.has(template)) keep.delete(template); else keep.add(template);
  try {
    await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options: {keep: [...keep]}}});
    toast(keep.has(template) ? `${name} : ne sera jamais vendu.` : `${name} : peut être vendu.`);
  } catch (x) { toast(x.message, true); }
}

$('#detail').addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { store.tab = tab.dataset.tab; $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.tab === store.tab)); renderTab(); updateDetail(); return; }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) doAction(action, e.target.closest('[data-action]'));
});

async function doAction(action, el) {
  const b = current();
  try {
    if (action === 'new') return openNew();
    if (!b) return;
    if (action === 'relaunch') {
      store.pendingSelect = b.meta.key;
      await api('/api/bots', {method: 'POST', body: {account: b.meta.account, character: nameOf(b), options: b.meta.options}});
      return toast('Bot relancé.');
    }
    if (action === 'kill' && !confirm('Arrêter le bot tout de suite, même en plein combat ?')) return;
    if (action === 'goto-map') return sendGoto(el.dataset.target);
    await api(`/api/bots/${encodeURIComponent(b.meta.key)}/${action}`, {method: 'POST', body: {}});
    if (action === 'forget') { store.selected = null; render(); }
  } catch (x) { toast(x.message, true); }
}
async function sendGoto(target) {
  const b = current();
  if (!b || !target) return;
  try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/goto`, {method: 'POST', body: {target}}); toast(`Direction ${target}.`); }
  catch (x) { toast(x.message, true); }
}

function updateDetail() {
  const b = current();
  if (!b) { if (store.bots.size) render(); return; }
  if (!$('#hero')) return renderDetail();
  updateHero(b);
  const fightBadge = $('[data-badge="combat"]');
  if (fightBadge) { fightBadge.hidden = !b.state?.fight; fightBadge.textContent = '!'; }
  if (store.tab === 'direct') updateLive(b);
  else if (store.tab === 'carte') updateMap(b);
  else if (store.tab === 'combat') updateFight(b);
  else if (store.tab === 'inventaire') { if (b.inventory && !$('#items .item, #items p:not(.muted)')) updateInventory(b); updateMarketInfo(b); updateCharacter(b); }
  else if (store.tab === 'bilan') updateTiles(b);
  else if (store.tab === 'reglages') updateSettingsInfo(b);
}

function updateHero(b) {
  const s = b.state || {}, st = botStatus(b), [cls, sex] = classOf(s.gfx), running = b.meta.running;
  const controls = running
    ? `${s.paused ? '<button class="btn" data-action="resume"><span class="ms">play_arrow</span>Reprendre</button>' : '<button class="btn" data-action="pause"><span class="ms">pause</span>Pause</button>'}
       <button class="btn danger" data-action="stop" ${s.stopRequested ? 'disabled' : ''}><span class="ms">stop</span>${s.stopRequested ? 'Arrêt en cours…' : 'Arrêter'}</button>`
    : `<button class="btn primary" data-action="relaunch"><span class="ms">replay</span>Relancer</button><button class="btn" data-action="forget"><span class="ms">delete</span>Retirer</button>`;
  const activity = !running && b.meta.error ? `<span style="color:var(--bad)">${esc(b.meta.error)}</span>` : esc(s.activity || (running ? 'Démarrage…' : 'Arrêté'));
  const xp = s.xp && s.xp.high > s.xp.low ? Math.max(0, Math.min(100, (s.xp.now - s.xp.low) / (s.xp.high - s.xp.low) * 100)) : null;
  const sum = s.summary || {}, hours = sum.started ? Math.max(1 / 60, (Date.now() - sum.started) / 3600000) : 0;
  const pods = s.bag?.pods?.max ? Math.round(s.bag.pods.used / s.bag.pods.max * 100) : null;
  const kpi = (icon, label, value, sub = '', cls2 = '') => `<div class="kpi ${cls2}"><span class="ms">${icon}</span><div><b>${value}</b><span>${label}${sub ? ` · ${sub}` : ''}</span></div></div>`;
  const where = s.map ? ` · <a href="#" data-tab-go="carte">[${s.map.x},${s.map.y}]</a>` : '';
  $('#hero').innerHTML = `<div class="hero-main">
      <div class="avatar big">${cls ? `<img src="${classIcon(cls, sex)}" alt="">` : '<span class="ms">smart_toy</span>'}</div>
      <div style="min-width:0">
        <h2>${esc(nameOf(b))} <span class="pill ${statusClass(st)}">${STATUS[st] || st}</span></h2>
        <div class="hero-sub">${s.level ? `${CLASS_NAMES[cls] || ''} niveau <b>${s.level}</b> · ` : ''}compte <b>${esc(b.meta.account)}</b>${where}</div>
        <div class="activity">${activity}</div>
      </div>
      <div class="controls">${controls}</div>
    </div>
    ${s.maxLife || xp !== null ? `<div class="hero-bars">
      ${s.maxLife ? `<div class="meter life"><span><span class="ms">favorite</span><b>${fmt(s.life)}</b> / ${fmt(s.maxLife)} PV</span><div class="bar"><i style="width:${lifePct(s.life, s.maxLife)}%"></i></div></div>` : ''}
      ${xp !== null ? `<div class="meter xp"><span><span class="ms">star</span><b>${xp.toFixed(1).replace('.', ',')} %</b> vers le niveau ${s.level + 1}</span><div class="bar xp"><i style="width:${xp}%"></i></div></div>` : ''}
    </div>` : ''}
    <div class="kpis">
      ${s.kamas !== null && s.kamas !== undefined ? kpi('payments', 'kamas', fmt(s.kamas), sum.kamas ? `+${fmt(sum.kamas)} ici` : '') : ''}
      ${kpi('swords', 'combats gagnés', `${fmt(sum.wins || 0)} / ${fmt(sum.fights || 0)}`, sum.losses ? `${sum.losses} défaite(s)` : '', sum.losses ? 'warn' : '')}
      ${sum.xp ? kpi('trending_up', 'XP par heure', fmt(sum.xp / hours)) : ''}
      ${s.market?.max ? kpi('sell', 'annonces HDV', fmt(s.market.listed), `sur ${fmt(s.market.max)}`) : ''}
      ${s.bag ? kpi('backpack', 'objets', fmt(s.bag.count), pods !== null ? `${pods} % des pods` : '', pods >= 80 ? 'warn' : '') : ''}
      ${s.goal ? kpi('flag', 'objectif', esc(s.goal), '', 'gold') : ''}
    </div>`;
}
$('#detail').addEventListener('click', e => {
  const go = e.target.closest('[data-tab-go]');
  if (!go) return;
  e.preventDefault();
  $(`[data-tab="${go.dataset.tabGo}"]`)?.click();
});

// --- Live ("Direct"): the bot as if watching the game ---------------------------------------------------------------
// The scene redraws its tokens only when they change; every frame it moves them along the paths the bot reports
// (its own walk, the monster groups, the fighters), with the clock of the bot corrected for this device.
const STYLE_NAMES = {offensif: 'offensif', prudent: 'prudent', distance: 'à distance'};
let liveFrame = 0;

function liveTokens(s, f) {
  const [cls, sex] = classOf(s.gfx);
  if (f) {
    return f.fighters.filter(x => x.cell >= 0 && !(x.dead && f.started)).map(x => ({
      id: `f${x.id}`, img: x.me ? classIcon(cls, sex) : monsterImg(x.template), label: x.me ? '★' : (x.name || '?').slice(0, 1),
      cls: `lt-fighter t${x.team === f.myTeam ? 0 : 1}${f.current === x.id ? ' turn' : ''}${x.me ? ' me' : ''}`,
      cell: x.cell, moving: x.moving, hp: x.maxLife ? lifePct(x.life, x.maxLife) : null,
      title: `${x.name} — ${fmt(x.life)}/${fmt(x.maxLife)} PV, ${x.ap} PA, ${x.mp} PM${x.threat ? ` · peut faire ~${fmt(x.threat)} dégâts par tour` : ''}`,
    }));
  }
  const out = (s.groups || []).map(g => ({
    id: `g${g.id}`, img: monsterImg(g.monsters[0]), label: g.monsters.length, badge: g.monsters.length > 1 ? g.monsters.length : null,
    cls: `lt-group${g.attackable ? ' ok' : ' off'}`, cell: g.cell, moving: g.moving ? {...g.moving, ms: 260} : null,
    title: `${g.names.map((n, i) => `${n} ${g.levels[i]}`).join(', ')}${g.verdict ? ` — ${g.verdict}` : ''}`,
  }));
  out.push({id: 'me', img: classIcon(cls, sex), label: '★', cls: 'lt-me', cell: s.cell,
    moving: s.walking?.length > 1 && s.walkStart ? {cells: s.walking, start: s.walkStart, ms: s.walkMs || 170} : null, title: s.character});
  return out;
}

function tokenSvg(t) {
  const len = 2 * Math.PI * 16;
  const ring = t.hp === null || t.hp === undefined ? '' : `<circle class="hp" r="16" stroke="${t.hp > 50 ? '#6cc47a' : t.hp > 25 ? '#e6b04a' : '#e2554f'}" stroke-dasharray="${(len * t.hp / 100).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90)"/>`;
  const face = t.img ? `<image href="${t.img}" x="-13" y="-13" width="26" height="26" clip-path="url(#lclip)" preserveAspectRatio="xMidYMid slice"/>` : `<text>${esc(t.label)}</text>`;
  return `<g class="lt ${t.cls}" data-tok="${t.id}"><title>${esc(t.title || '')}</title><circle class="halo" r="19"/>${ring}<circle class="bg" r="14"/>${face}${t.badge ? `<g class="badge" transform="translate(12,-12)"><circle r="8"/><text>${t.badge}</text></g>` : ''}</g>`;
}

function tokenPos(map, t, now) {
  const m = t.moving;
  if (m?.cells?.length > 1) {
    const k = (now - m.start) / m.ms;
    if (k >= 0 && k < m.cells.length - 1) {
      const i = Math.floor(k), r = k - i;
      const [x1, y1] = cellCenter(map.width, m.cells[i]), [x2, y2] = cellCenter(map.width, m.cells[i + 1]);
      return [x1 + (x2 - x1) * r, y1 + (y2 - y1) * r, false];
    }
  }
  const [x, y] = cellCenter(map.width, t.cell);
  return [x, y, true];
}

function liveTick() {
  liveFrame = 0;
  const L = store.live;
  if (!L || !L.layer.isConnected) return;
  const now = Date.now() - L.skew;
  let busy = false;
  for (const t of L.tokens) {
    const el = L.els.get(t.id);
    if (!el) continue;
    const [x, y, still] = tokenPos(L.map, t, now);
    if (!still) busy = true;
    el.setAttribute('transform', `translate(${x.toFixed(1)},${(y - 6).toFixed(1)})`);
  }
  if (busy) liveFrame = requestAnimationFrame(liveTick);
}

/** The plan of its turn drawn on the grid: where it goes (dashed) and what it aims at. */
function planLayer(map, f) {
  const t = f?.thinking;
  if (!t || t.turn !== f.turn || !f.myTurn) return '';
  let html = '';
  const p = t.plan;
  if (p) {
    const [fx, fy] = cellCenter(map.width, p.from);
    html += `<path class="plan-cell" d="${diamond(fx, fy)}"/>`;
    for (const c of p.casts) {
      if (c.cell === p.from) continue;
      const [x, y] = cellCenter(map.width, c.cell);
      html += `<line class="plan-aim" x1="${fx}" y1="${fy - 6}" x2="${x}" y2="${y - 6}"/><circle class="plan-target" cx="${x}" cy="${y - 6}" r="17"/>`;
    }
  }
  if (t.end && t.end.cell !== p?.from) { const [x, y] = cellCenter(map.width, t.end.cell); html += `<path class="plan-end" d="${diamond(x, y)}"/>`; }
  return html;
}

async function updateLive(b) {
  const host = $('#live-svg');
  if (!host) return;
  updateThink(b);
  updateFeed(b);
  const s = b.state;
  if (!s?.map) { host.innerHTML = `<p class="muted" style="padding:40px;text-align:center">${b.meta.running ? 'En attente du bot…' : 'Bot arrêté.'}</p>`; store.drawn = {}; return; }
  const map = await getMap(s.map.id);
  if (!map || current() !== b || !$('#live-svg')) return;
  const f = s.fight || null;
  const turnOf = f?.fighters.find(x => x.id === f.current);
  $('#live-title').textContent = `[${s.map.x},${s.map.y}]`;
  $('#live-sub').textContent = f
    ? (f.started ? `combat · tour ${f.turn}${turnOf ? ` · au tour de ${turnOf.me ? 'du bot' : turnOf.name}` : ''}` : 'placement')
    : `carte ${s.map.id} · ${s.groups.length} groupe(s)`;
  const key = `${map.id}:${f ? `f${f.started ? 'g' : 'p'}` : 'r'}`;
  const fresh = store.drawn[host.id] !== key;
  const over = ensureSvg(host, map, key, cellsLayer(map, {fight: !!f, places: f && !f.started ? f.places : null}));
  const svg = host.querySelector('svg');
  if (fresh) {
    svg.insertAdjacentHTML('afterbegin', '<defs><clipPath id="lclip"><circle r="13"/></clipPath></defs>');
    over.insertAdjacentHTML('beforebegin', '<g class="plan"></g><g class="trail"></g>');
    svg.classList.remove('enter'); void svg.getBoundingClientRect(); svg.classList.add('enter');
  }
  svg.querySelector('.plan').innerHTML = f ? planLayer(map, f) : '';
  svg.querySelector('.trail').innerHTML = !f && s.walking?.length > 1 ? `<polyline class="path" points="${s.walking.map(c => cellCenter(map.width, c).map(v => v.toFixed(1)).join(',')).join(' ')}"/>` : '';
  const tokens = liveTokens(s, f);
  const sig = tokens.map(t => `${t.id}|${t.img}|${t.cls}|${t.badge || ''}|${t.hp === null || t.hp === undefined ? '' : Math.round(t.hp)}`).join(';');
  if (over.dataset.sig !== sig) {
    over.innerHTML = tokens.map(tokenSvg).join('');
    over.dataset.sig = sig;
  }
  const els = new Map([...over.querySelectorAll('[data-tok]')].map(el => [el.dataset.tok, el]));
  store.live = {layer: over, map, tokens, els, skew: s.now ? Date.now() - s.now : 0};
  if (!liveFrame) liveFrame = requestAnimationFrame(liveTick);
  if (f) setFx(host, map, f);
  const cap = $('#live-caption');
  if (cap) cap.innerHTML = f ? fightCaption(f) : esc(s.activity || '');
}

function fightCaption(f) {
  const last = f.feed?.[f.feed.length - 1];
  return last ? esc(last) : 'Combat en cours…';
}

/** "Ce qu'il pense": its plan of the turn in a fight, else what it is doing and why. */
function updateThink(b) {
  const el = $('#live-think');
  if (!el) return;
  const s = b.state || {}, f = s.fight;
  let html = '';
  if (!b.meta.running) html = '<p class="muted" style="margin:0">Bot arrêté.</p>';
  else if (f) {
    const t = f.thinking;
    const foes = f.fighters.filter(x => x.team !== f.myTeam && !x.dead).sort((a, c) => (c.threat || 0) - (a.threat || 0));
    html += `<div class="think-head"><span class="pill st-combat">${f.started ? `tour ${f.turn}` : 'placement'}</span>${t?.style ? `<span>style <b>${STYLE_NAMES[t.style] || t.style}</b></span>` : ''}${f.myTurn ? '<span class="gold">à lui de jouer</span>' : ''}</div>`;
    if (t?.plan) {
      const p = t.plan;
      html += `<ol class="plan">${p.teleport ? `<li><span class="ms">bolt</span>${esc(p.teleport.spell)} vers la case ${p.teleport.cell}</li>` : p.steps ? `<li><span class="ms">directions_walk</span>se place en case ${p.from} (${p.steps} pas)</li>` : ''}
        ${p.casts.map(c => `<li><span class="ms">auto_fix_high</span><b>${esc(c.spell)}</b> → ${esc(c.target)} <span class="muted">~${fmt(c.value)}</span></li>`).join('')}</ol>
        <div class="think-line">Valeur du tour ~<b>${fmt(p.total)}</b> · ce qu'il risque là-bas ~<b>${fmt(p.threat)}</b> PV</div>`;
    } else if (t?.note) html += `<div class="think-line">${esc(t.note)}</div>`;
    if (t?.buffs?.length) html += `<div class="think-line">Boosts pesés : ${t.buffs.map(x => `${esc(x.spell)} <b class="${x.cast ? 'gold' : ''}">${x.gain > 0 ? '+' : ''}${fmt(x.gain)}</b>${x.cast ? ' (lancé)' : ''}`).join(' · ')}</div>`;
    if (t?.end) html += `<div class="think-line">Fin de tour : case ${t.end.cell}, ~<b>${fmt(t.end.threat)}</b> PV de dégâts possibles au tour des monstres</div>`;
    if (foes.length) html += `<div class="think-foes">${foes.map(x => `<span title="${esc(x.name)}">${monsterImg(x.template) ? `<img src="${monsterImg(x.template)}" alt="">` : ''}${esc(x.name)} <b>⚔ ${fmt(x.threat || 0)}</b></span>`).join('')}</div>`;
    if (!t) html += '<p class="muted" style="margin:0">Il réfléchit à son premier tour…</p>';
  } else {
    const i = s.intent;
    const line = {
      trajet: i => `<span class="ms">route</span>Il part <b>${esc(i.why || 'chasser')}</b> en [${i.x},${i.y}] : ${i.hops} changement(s) de carte${i.names?.length ? `<div class="muted">${esc(i.names.join(', '))}${i.level ? `, niveau ~${i.level}` : ''}</div>` : ''}`,
      attaque: i => `<span class="ms">target</span>Il attaque ${i.monsters.map(m => `${monsterImg(m.template) ? `<img class="mini" src="${monsterImg(m.template)}" alt="">` : ''}${esc(m.name)} ${m.level}`).join(', ')}${i.verdict ? `<div class="muted">Estimation : ${esc(i.verdict)}</div>` : ''}`,
      objectif: i => `<span class="ms">flag</span>Il se rend à l'objectif <b>${esc(i.goal || '')}</b> : encore ${i.hops} carte(s)`,
      repos: i => `<span class="ms">hotel</span>Il se repose : ${fmt(i.life)} / ${fmt(i.maxLife)} PV, jusqu'à ${fmt(i.until)} (~${Math.round(i.seconds / 60)} min)`,
      vente: () => '<span class="ms">sell</span>Il est à l\'hôtel de vente : il met son butin en vente au bon prix',
      attente: i => `<span class="ms">hourglass_top</span>${esc(i.text || 'Il attend.')}`,
      combat: () => '<span class="ms">swords</span>Un combat commence',
    }[i?.kind];
    html += `<div class="think-intent">${line ? line(i) : `<span class="ms">explore</span>${esc(s.activity || 'Il cherche des monstres à sa mesure.')}`}</div>`;
    const groups = [...(s.groups || [])].sort((a, c) => (c.attackable - a.attackable) || (a.total - c.total)).slice(0, 4);
    if (groups.length) html += `<div class="think-sub">Sur la carte :</div><div class="think-groups">${groups.map(g => `<div class="${g.attackable ? 'ok' : 'off'}">${monsterImg(g.monsters[0]) ? `<img src="${monsterImg(g.monsters[0])}" alt="">` : ''}<span>${esc(g.names.slice(0, 3).join(', '))}${g.names.length > 3 ? '…' : ''} <span class="muted">(${g.total})</span></span><em>${esc(g.verdict || (g.attackable ? 'à sa mesure' : 'ignoré'))}</em></div>`).join('')}</div>`;
  }
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

/** The live feed: what it did, newest first (map changes in a row folded into one line). */
function updateFeed(b) {
  const el = $('#live-feed');
  if (!el) return;
  b.liveEvents ||= new Map();
  for (const e of b.state?.events || []) b.liveEvents.set(e.id, e);
  if (b.liveEvents.size > 150) for (const id of [...b.liveEvents.keys()].slice(0, b.liveEvents.size - 150)) b.liveEvents.delete(id);
  const events = [...b.liveEvents.values()].sort((a, c) => a.id - c.id);
  // Moves in a row (map changes, new destinations) are one line.
  const rows = [];
  for (const e of events) {
    const prev = rows[rows.length - 1], moving = e.kind === 'carte' || e.kind === 'trajet';
    if (!moving) { rows.push(e); continue; }
    const row = prev?.kind === 'move' ? prev : (rows.push({kind: 'move', id: e.id, t: e.t, maps: [], trip: null}), rows[rows.length - 1]);
    if (e.kind === 'carte') row.maps.push(e); else row.trip = e;
    row.t = e.t;
  }
  const items = list => (list || []).map(it => `<span class="ev-item" title="${esc(it.name || '')}${it.qty > 1 ? ` ×${it.qty}` : ''}">${itemIcon(it.template) ? `<img src="${itemIcon(it.template)}" alt="">` : '<span class="ms">inventory_2</span>'}${it.qty > 1 ? `<b>${fmt(it.qty)}</b>` : ''}</span>`).join('');
  const mobs = list => (list || []).map(m => `<span class="ev-mob" title="${esc(m.name)} ${m.level || ''}">${monsterImg(m.template) ? `<img src="${monsterImg(m.template)}" alt="">` : esc((m.name || '?').slice(0, 1))}</span>`).join('');
  const render = e => {
    const r = {
      combat: () => ['swords', 'act', `Combat contre ${esc(e.monsters.map(m => `${m.name}${m.level ? ` ${m.level}` : ''}`).join(', '))}`, `<div class="ev-row">${mobs(e.monsters)}</div>`],
      victoire: () => ['emoji_events', 'win', `Victoire en ${e.turns} tour(s) : +${fmt(e.xp)} XP, +${fmt(e.kamas)} kamas${e.count ? `, ${fmt(e.count)} objet(s)` : ''}`, e.items?.length ? `<div class="ev-row">${items(e.items)}</div>` : ''],
      defaite: () => ['heart_broken', 'bad', `Défaite en ${e.turns} tour(s)`, ''],
      niveau: () => ['star', 'win', `Niveau ${e.level} !`, ''],
      caracs: () => ['fitness_center', '', `Caractéristiques : ${esc(e.text)}`, ''],
      sorts: () => ['auto_fix_high', '', `Sorts améliorés : ${esc(e.text)}`, ''],
      equipement: () => ['shield', '', `Équipement : ${esc(e.items.map(i => `${i.name}${i.gain ? ` (+${i.gain} %)` : ''}`).join(', '))}`, `<div class="ev-row">${items(e.items)}</div>`],
      hdv: () => ['sell', 'gold', `${fmt(e.listed)} lot(s) mis en vente pour ${kamas(e.total)}`, `<div class="ev-row">${items(e.top)}</div>`],
      vente: () => ['payments', 'win', `Vendu : ${esc(e.name)} pour ${kamas(e.price)}`, `<div class="ev-row">${items([{template: e.template, name: e.name}])}</div>`],
      soins: () => ['favorite', '', `Soins : ${e.used} consommable(s), ${fmt(e.from)} → ${fmt(e.to)} PV`, ''],
      repos: () => ['hotel', '', `Repos : ${fmt(e.life)} / ${fmt(e.maxLife)} PV`, ''],
      trajet: () => ['route', 'move', `Part ${esc(e.why || 'chasser')} en [${e.x},${e.y}] (${e.hops} carte(s))${e.names?.length ? ` : ${esc(e.names.join(', '))}` : ''}`, ''],
      move: () => {
        const m = e.maps, trip = e.trip;
        const path = m.length > 1 ? `${m.length} cartes, [${m[0].x},${m[0].y}] → [${m[m.length - 1].x},${m[m.length - 1].y}]` : m.length ? `carte [${m[0].x},${m[0].y}]` : '';
        const goal = trip ? `vers [${trip.x},${trip.y}] pour ${trip.why || 'chasser'}${trip.names?.length ? ` (${trip.names.join(', ')})` : ''}` : '';
        return ['route', 'move', `Déplacement${path ? ` : ${path}` : ''}${goal ? ` · ${esc(goal)}` : ''}`, ''];
      },
      attaque: () => ['target', 'act', `Attaque ${esc(e.monsters.map(m => `${m.name} ${m.level}`).join(', '))}${e.verdict ? ` — ${esc(e.verdict)}` : ''}`, `<div class="ev-row">${mobs(e.monsters)}</div>`],
      probleme: () => ['warning', 'bad', esc(e.text || 'Problème'), ''],
    }[e.kind]?.() || ['info', '', esc(e.text || e.kind), ''];
    return `<div class="ev ${r[1]}"><span class="ms ev-ico">${r[0]}</span><div class="ev-body"><div class="ev-text">${r[2]}</div>${r[3]}</div><time>${clock(e.t)}</time></div>`;
  };
  const html = rows.length ? rows.slice(-60).reverse().map(render).join('') : '<p class="muted" style="margin:0">Le fil se remplit dès que le bot agit.</p>';
  const meta = $('#feed-meta');
  if (meta) meta.textContent = rows.length ? `${rows.length} évènement(s)` : '';
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

// --- Map --------------------------------------------------------------------------------------------------------------
const CW = 53, CH = 27;
function cellCenter(w, c) {
  const line = Math.floor(c / (2 * w - 1)), rem = c % (2 * w - 1);
  return rem < w ? [rem * CW + CW / 2, line * CH + CH / 2] : [(rem - w) * CW + CW, line * CH + CH];
}
const diamond = (x, y) => `M${x},${y - CH / 2}L${x + CW / 2},${y}L${x},${y + CH / 2}L${x - CW / 2},${y}Z`;
async function getMap(id) {
  if (store.maps.has(id)) return store.maps.get(id);
  const p = api(`/api/map/${id}`).catch(() => null);
  store.maps.set(id, p);
  const data = await p;
  store.maps.set(id, data);
  return data;
}
/** Static layer: one path per kind of cell. `fight` uses the fight walkability; `places` highlights placements. */
function cellsLayer(map, {fight = false, places = null} = {}) {
  const kinds = {void: [], wall: [], ground: [], crop: [], io: [], tp: [], special: [], place0: [], place1: []};
  const tps = new Set(map.teleports.map(t => t[0])), special = new Set(map.special);
  const p0 = new Set(places?.[0] || []), p1 = new Set(places?.[1] || []);
  for (let c = 0; c < map.cellCount; c++) {
    const walk = (fight ? map.walkFight : map.walk)[c] === '1', io = map.io[c], [x, y] = cellCenter(map.width, c);
    let kind;
    if (places && p0.has(c)) kind = 'place0';
    else if (places && p1.has(c)) kind = 'place1';
    else if (!fight && tps.has(c)) kind = 'tp';
    else if (!fight && special.has(c)) kind = 'special';
    else if (io === '2') kind = 'io';
    else if (walk && io === '1') kind = 'crop';
    else if (walk) kind = 'ground';
    else if (map.los[c] === '0') kind = 'wall';
    else kind = 'void';
    kinds[kind].push(diamond(x, y));
  }
  return Object.entries(kinds).filter(([, d]) => d.length).map(([k, d]) => `<path class="c c-${k}" d="${d.join('')}"/>`).join('');
}
function token(map, cell, cls, label, title, extra = '') {
  if (cell === null || cell === undefined || cell < 0) return '';
  const [x, y] = cellCenter(map.width, cell);
  return `<g class="${cls}" transform="translate(${x},${y - 6})">${title ? `<title>${esc(title)}</title>` : ''}${extra}${label !== undefined ? `<text y="0">${esc(label)}</text>` : ''}</g>`;
}
function ensureSvg(host, map, key, layer) {
  if (store.drawn[host.id] === key) return host.querySelector('.over');
  host.innerHTML = `<svg viewBox="${-CW / 2} ${-CH} ${map.width * CW + CW} ${map.height * CH + CH * 1.5}" preserveAspectRatio="xMidYMid meet"><g class="cells">${layer}</g><g class="over"></g><g class="fx"></g></svg>`;
  store.drawn[host.id] = key;
  return host.querySelector('.over');
}

// Fight effects (spells cast, life lost or healed), animated at the screen's pace between two state updates.
const fxHosts = new Map();
let fxFrame = 0;
function setFx(host, map, fight) {
  const layer = host?.querySelector('.fx');
  if (!layer || !fight) return;
  fxHosts.set(host.id, {layer, map, fight});
  if (!fxFrame) fxFrame = requestAnimationFrame(drawFx);
}
function drawFx() {
  fxFrame = 0;
  let alive = false;
  for (const [id, h] of fxHosts) {
    if (!h.layer.isConnected) { fxHosts.delete(id); continue; }
    const now = Date.now() - (h.fight.skew || 0);
    let html = '';
    for (const fx of h.fight.fx || []) {
      const age = now - fx.t;
      if (age < 0 || age > 2600) continue;
      alive = true;
      if (fx.kind === 'cast' && age < 1300) {
        const [x1, y1] = cellCenter(h.map.width, fx.from), [x2, y2] = cellCenter(h.map.width, fx.to);
        const k = Math.min(1, age / 260), o = (1 - age / 1300).toFixed(2), side = fx.mine ? 'mine' : 'foe';
        html += `<line class="fx-cast ${side}" x1="${x1}" y1="${y1 - 6}" x2="${x1 + (x2 - x1) * k}" y2="${y1 + (y2 - y1) * k - 6}" opacity="${o}"/>`;
        if (k >= 1) html += `<circle class="fx-hit ${side}" cx="${x2}" cy="${y2 - 6}" r="${(8 + age / 50).toFixed(1)}" opacity="${o}"/>`;
        // the spell's name above the caster, higher than the damage numbers of the target
        if (fx.spell && age < 1100) html += `<text class="fx-spell ${side}" x="${x1}" y="${(y1 - 52 - age / 80).toFixed(1)}" opacity="${(1 - age / 1100).toFixed(2)}">${esc(fx.spell)}</text>`;
      } else if (fx.kind === 'death' && age < 1800) {
        const [x, y] = cellCenter(h.map.width, fx.cell);
        html += `<text class="fx-death" x="${x}" y="${y - 2}" opacity="${(1 - age / 1800).toFixed(2)}" font-size="${(22 + age / 40).toFixed(0)}">✖</text>`;
      } else if (fx.kind === 'life') {
        const [x, y] = cellCenter(h.map.width, fx.cell);
        // several hits on the same fighter are spread instead of piling up
        const lane = (h.fight.fx || []).filter(o2 => o2.kind === 'life' && o2.cell === fx.cell && o2.t < fx.t && fx.t - o2.t < 900).length;
        html += `<text class="fx-life ${fx.value < 0 ? 'neg' : 'pos'}" x="${x + (lane % 2 ? 16 : -16) * Math.min(1, lane)}" y="${(y - 24 - lane * 14 - age / 40).toFixed(1)}" opacity="${Math.max(0, 1 - age / 2600).toFixed(2)}">${fx.value > 0 ? '+' : ''}${fx.value}</text>`;
      }
    }
    h.layer.innerHTML = html;
  }
  if (alive) fxFrame = requestAnimationFrame(drawFx);
}

async function updateMap(b) {
  const s = b.state;
  const host = $('#map-svg');
  if (!host) return;
  if (!s?.map) { host.innerHTML = '<p class="muted" style="padding:30px;text-align:center">En attente de la carte…</p>'; store.drawn = {}; return; }
  const map = await getMap(s.map.id);
  if (!map || current() !== b || !$('#map-svg')) return;
  const inFight = !!s.fight;
  $('#map-title').textContent = `[${s.map.x},${s.map.y}]`;
  $('#map-sub').textContent = `carte ${s.map.id}${inFight ? ' · combat en cours' : ` · ${s.groups.length} groupe(s)`}`;
  const over = ensureSvg(host, map, `${map.id}:${inFight ? 'f' : 'r'}`, cellsLayer(map, {fight: inFight}));
  let html = '';
  if (inFight) html = fightTokens(map, s.fight);
  else {
    if (s.walking?.length > 1) html += `<polyline class="path" points="${s.walking.map(c => cellCenter(map.width, c).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
    for (const g of s.groups) html += token(map, g.cell, `group${g.attackable ? '' : ' off'}`, g.monsters.length, `${g.names.map((n, i) => `${n} ${g.levels[i]}`).join(', ')} (niveau total ${g.total})`, '<circle r="11"/>');
    html += token(map, s.cell, 'me', undefined, nameOf(b), '<circle class="halo" r="11"/><circle class="core" r="9"/>');
  }
  over.innerHTML = html;
  if (inFight) setFx(host, map, s.fight);
  updateGroups(s);
  updateRoute(s);
}

function updateGroups(s) {
  const el = $('#groups');
  if (!el) return;
  $('#groups-meta').textContent = s.range ? `chasse niv. ${s.range.minLevel}–${s.range.maxLevel}` : '';
  if (!s.groups.length) { el.innerHTML = '<p class="muted" style="margin:0">Aucun groupe de monstres sur cette carte.</p>'; return; }
  const groups = [...s.groups].sort((a, b) => (b.attackable - a.attackable) || (a.total - b.total));
  el.innerHTML = groups.map(g => `<div class="group-row" title="${esc(g.names.map((n, i) => `${n} ${g.levels[i]}`).join(', '))}">
      <div class="mobs">${g.monsters.slice(0, 3).map(m => (monsterImg(m) ? `<img src="${monsterImg(m)}" alt="" loading="lazy">` : '')).join('')}${g.monsters.length > 3 ? `<b>+${g.monsters.length - 3}</b>` : ''}</div>
      <div class="names">${esc(g.names.map((n, i) => `${n} ${g.levels[i]}`).join(', '))}</div>
      <span class="pill ${g.attackable ? 'st-chasse' : 'st-arrete'}">${g.attackable ? 'à sa mesure' : 'ignoré'}</span>
      <div class="ginfo">niveau total ${g.total}${g.verdict ? ` · ${esc(g.verdict)}` : ''}</div>
    </div>`).join('');
}

async function updateRoute(s) {
  const el = $('#route');
  if (!el) return;
  const route = s.route || [];
  $('#route-meta').textContent = route.length ? `${route.length} changement(s) de carte` : '';
  el.innerHTML = route.length
    ? route.map((m, i) => `<span class="${i === route.length - 1 ? 'target' : ''}">${m.x !== undefined ? `[${m.x},${m.y}]` : m.id}</span>`).join('') + (s.target && !s.goal ? `<p class="hint" style="width:100%">Chasse visée : ${esc(s.target.names.join(', '))}${s.target.level ? ` (niveau ~${s.target.level})` : ''}</p>` : '')
    : `<p class="muted" style="margin:0">${s.goal ? 'Calcul du trajet…' : 'Il chasse sur cette carte.'}</p>`;
  const svg = $('#world');
  if (!svg || !s.map) return;
  const key = `${s.map.id}`;
  let data = store.around.get(key);
  if (!data) {
    data = await api(`/api/around/${s.map.id}?hops=12`).catch(() => null);
    if (!data) return;
    store.around.set(key, data);
    if (store.around.size > 40) store.around.delete(store.around.keys().next().value);
  }
  if (!$('#world') || current()?.state?.map?.id !== s.map.id) return;
  const xs = data.maps.map(m => m.x), ys = data.maps.map(m => m.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), S = 14;
  const routeIds = new Set(route.map(m => m.id)), target = route.length ? route[route.length - 1].id : null;
  svg.setAttribute('viewBox', `-2 -2 ${(maxX - minX + 1) * S + 4} ${(maxY - minY + 1) * S + 4}`);
  svg.innerHTML = data.maps.map(m => {
    const cls = [m.mobs ? 'mobs' : 'plain', routeIds.has(m.id) ? 'route' : '', m.id === s.map.id ? 'here' : '', m.id === target ? 'target' : ''].join(' ');
    return `<rect class="${cls}" x="${(m.x - minX) * S}" y="${(m.y - minY) * S}" width="${S - 2}" height="${S - 2}" rx="2" data-map="${m.id}"><title>[${m.x},${m.y}] carte ${m.id}${m.mobs ? ' · monstres' : ''}</title></rect>`;
  }).join('');
}
document.addEventListener('click', e => {
  const rect = e.target.closest?.('#world rect');
  if (!rect) return;
  const m = rect.dataset.map, t = rect.querySelector('title')?.textContent.split(' ')[0];
  if (confirm(`Envoyer le bot en ${t} (carte ${m}) ?`)) sendGoto(m);
});

// --- Fight ------------------------------------------------------------------------------------------------------------
function fightTokens(map, f) {
  let html = '';
  for (const x of f.fighters) {
    if (x.cell < 0 || (x.dead && f.started)) continue;
    const pct = lifePct(x.life, x.maxLife), r = 14, len = 2 * Math.PI * r;
    const hp = x.maxLife ? `<circle class="hp" r="${r}" stroke="${pct > 50 ? '#6cc47a' : pct > 25 ? '#e6b04a' : '#e2554f'}" stroke-dasharray="${(len * pct / 100).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90)"/>` : '';
    const label = x.me ? '★' : (x.name || '?').slice(0, 1);
    html += token(map, x.cell, `token t${x.team}${x.dead ? ' dead' : ''}${f.current === x.id ? ' turn' : ''}`, label, `${x.name} — ${fmt(x.life)}/${fmt(x.maxLife)} PV, ${x.ap} PA, ${x.mp} PM`, `${f.current === x.id ? '<circle class="ring" r="18"/>' : ''}${hp}<circle class="core" r="10"/>`);
  }
  return html;
}
async function updateFight(b) {
  const wrap = $('#fight-wrap');
  if (!wrap) return;
  const s = b.state, f = s?.fight;
  if (!f) {
    if (store.drawn.fightWrap !== 'none') {
      const last = [...b.logs].reverse().find(l => /^(Victoire|Défaite)/.test(l.text));
      wrap.innerHTML = `<div class="panel nofight"><span class="ms">swords</span>Pas de combat en cours.${last ? `<p>Dernier combat (${clock(last.time)}) : ${esc(last.text)}</p>` : ''}</div>`;
      store.drawn = {fightWrap: 'none'};
    }
    return;
  }
  if (store.drawn.fightWrap !== 'fight') {
    wrap.innerHTML = `<div class="grid-2">
      <div class="panel mapbox"><div class="maphead"><b>Combat</b><span class="muted" id="fight-sub"></span></div><div id="fight-svg"></div>
        <div class="legend"><span><i style="background:var(--team0)"></i>équipe du bot</span><span><i style="background:var(--team1)"></i>ennemis</span><span>anneau : points de vie</span></div></div>
      <div class="tab"><div class="panel card"><h3>Combattants</h3><div class="fighters" id="fighters"></div></div>
        <div class="panel card"><h3>Actions</h3><div class="feed" id="feed"></div></div></div></div>`;
    store.drawn = {fightWrap: 'fight'};
  }
  const map = s.map && await getMap(s.map.id);
  if (!map || !$('#fight-svg')) return;
  const placing = !f.started && f.places;
  const turnOf = f.fighters.find(x => x.id === f.current);
  const STYLE = {offensif: 'offensif', prudent: 'prudent', distance: 'à distance'};
  $('#fight-sub').textContent = placing ? 'placement' : `tour ${f.turn}${turnOf ? ` · au tour de ${turnOf.me ? 'du bot' : turnOf.name}` : ''}${f.style ? ` · style ${STYLE[f.style] || f.style}` : ''}`;
  const over = ensureSvg($('#fight-svg'), map, `${map.id}:fight:${placing ? 'p' : 'g'}`, cellsLayer(map, {fight: true, places: placing ? f.places : null}));
  over.innerHTML = fightTokens(map, f);
  setFx($('#fight-svg'), map, f);
  const mine = f.myTeam;
  const fighters = [...f.fighters].sort((a, c) => (a.team === mine ? 0 : 1) - (c.team === mine ? 0 : 1) || a.dead - c.dead);
  $('#fighters').innerHTML = fighters.map(x => {
    const [cls, sex] = x.me ? classOf(s.gfx) : [null, 0];
    const img = x.me ? classIcon(cls, sex) : monsterImg(x.template);
    return `<div class="fighter${f.current === x.id ? ' turn' : ''}${x.dead ? ' dead' : ''}">
      ${img ? `<img src="${img}" alt="">` : '<span class="avatar" style="width:38px;height:38px"><span class="ms">person</span></span>'}
      <div style="min-width:0"><div class="fname team-${x.team === mine ? 0 : 1}">${x.me ? '★ ' : ''}${esc(x.name)}${x.summon ? ' <span class="muted">(invocation)</span>' : ''}</div>
        <div class="bar"><i style="width:${lifePct(x.life, x.maxLife)}%"></i></div></div>
      <div class="pts">${x.dead ? '<span>vaincu</span>' : `${x.threat ? `<span class="threat" title="dégâts qu'il peut faire en un tour (ses sorts, ses PA)">⚔ ${fmt(x.threat)}</span>` : ''}<span title="points de vie">${fmt(x.life)}</span><span title="points d'action">${x.ap} PA</span><span title="points de mouvement">${x.mp} PM</span>`}</div>
    </div>`;
  }).join('');
  $('#feed').innerHTML = f.feed.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('') || '<p class="muted" style="margin:0">Placement…</p>';
}

// --- Log --------------------------------------------------------------------------------------------------------------
function logClass(t) {
  if (/^(Victoire|Objectif atteint|Niveau \d+)/.test(t)) return 'win';
  if (/(Défaite|Erreur|refusé|Arrêt|fermé|introuvable|Trop|impossible)/i.test(t)) return 'bad';
  if (/^(J'attaque|Le combat commence)/.test(t)) return 'act';
  if (/^(Je pars|En route|Le passage)/.test(t)) return 'move';
  if (/^\s/.test(t)) return 'sub';
  return '';
}
const logLine = l => `<div class="${logClass(l.text)}"><time>${clock(l.time)}</time>${esc(l.text)}</div>`;
function appendLog(line) {
  const log = $('#log');
  if (!log) return;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.insertAdjacentHTML('beforeend', logLine(line));
  while (log.children.length > 500) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// --- Summary ----------------------------------------------------------------------------------------------------------
function updateTiles(b) {
  const el = $('#tiles');
  const sum = b.state?.summary;
  if (!el || !sum) { if (el) el.innerHTML = '<p class="muted">En attente des premières données…</p>'; return; }
  const ms = (b.meta.ended || Date.now()) - sum.started, hours = Math.max(ms / 3600000, 1 / 60);
  const tile = (icon, k, v, s = '') => `<div class="tile"><div class="k"><span class="ms" style="font-size:17px">${icon}</span>${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  el.innerHTML = [
    tile('swords', 'Combats', fmt(sum.fights), `${fmt(sum.wins)} victoire(s), ${fmt(sum.losses)} défaite(s)`),
    tile('trending_up', 'XP gagnée', fmt(sum.xp), `${fmt(sum.xp / hours)} / heure`),
    tile('payments', 'Kamas gagnés', fmt(sum.kamas), `${fmt(sum.kamas / hours)} / heure`),
    tile('inventory_2', 'Objets ramassés', fmt(sum.items), `${fmt(sum.items / hours)} / heure`),
    tile('map', 'Cartes visitées', fmt(sum.maps), ''),
    tile('sell', 'Mis en vente', fmt(sum.listed || 0), 'lot(s) à l\'hôtel de vente'),
    tile('savings', 'Ventes HDV', kamas(sum.sold || 0), `${fmt((sum.sold || 0) / hours)} / heure`),
    tile('schedule', 'Durée', duration(ms), b.meta.running ? 'en cours' : 'terminée'),
  ].join('') + xpCurve(b);
}
/** XP gained during this session, as seen by this page (points collected from the live updates). */
function xpCurve(b) {
  const pts = b.xp || [];
  if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, x0 = pts[0].xp, x1 = pts[pts.length - 1].xp;
  if (t1 <= t0 || x1 <= x0) return '';
  const W = 600, H = 120;
  const line = pts.map(p => `${((p.t - t0) / (t1 - t0) * W).toFixed(1)},${(H - (p.xp - x0) / (x1 - x0) * (H - 8) - 4).toFixed(1)}`).join(' ');
  return `<div class="tile curve"><div class="k"><span class="ms" style="font-size:17px">show_chart</span>XP gagnée depuis l'ouverture de cette page</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon class="area" points="0,${H} ${line} ${W},${H}"/><polyline class="line" points="${line}"/></svg>
    <div class="s">+${fmt(x1 - x0)} XP en ${duration(t1 - t0)}</div></div>`;
}
async function loadHistory() {
  const el = $('#history');
  if (!el) return;
  if (!store.history) store.history = (await api('/api/history').catch(() => ({history: []}))).history.filter(h => h.fights || h.maps); // not the starts that failed
  if (!$('#history')) return;
  if (!store.history.length) { el.innerHTML = '<p class="muted" style="margin:0">Aucune session terminée pour l\'instant.</p>'; return; }
  el.innerHTML = `<table class="history"><thead><tr><th>Fin</th><th>Personnage</th><th>Niveau</th><th class="n">Combats</th><th class="n">XP</th><th class="n">Kamas</th><th class="n">Objets</th><th class="n">Durée</th></tr></thead><tbody>
    ${store.history.map(h => `<tr><td>${new Date(h.ended).toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</td><td>${esc(h.character)}</td><td>${h.level ?? '–'}</td>
      <td class="n">${fmt(h.wins)} / ${fmt(h.fights)}</td><td class="n">${fmt(h.xp)}</td><td class="n">${fmt(h.kamas)}</td><td class="n">${fmt(h.items)}</td><td class="n">${duration(h.ended - h.started)}</td></tr>`).join('')}
  </tbody></table>`;
}

// --- Settings (built once per opening: live updates never wipe what is being typed) -------------------------------
const OPTION_FIELDS = [
  ['minLevel', 'Niveau min. des cartes de chasse', 'auto'], ['maxLevel', 'Niveau max. des cartes de chasse', 'auto'],
  ['factor', 'Facteur (niveau total des groupes)', '1.2'], ['maxMonsters', 'Monstres max. par groupe', '8'],
  ['rest', 'Se repose sous (% de vie)', '50'], ['maxFights', "S'arrête après (combats)", 'jamais'], ['maxMinutes', "S'arrête après (minutes)", 'jamais'],
];
function optionInputs(values = {}, prefix = 'opt') {
  return `<div class="form-grid">${OPTION_FIELDS.map(([key, label, ph]) => `<label class="field"><span>${label}</span><input type="number" step="any" min="0" name="${prefix}-${key}" placeholder="${ph}" value="${values[key] ?? ''}"></label>`).join('')}</div>`;
}
function readOptions(root, prefix = 'opt') {
  const out = {};
  for (const [key] of OPTION_FIELDS) { const v = root.querySelector(`[name="${prefix}-${key}"]`)?.value.trim(); out[key] = v === '' || v === undefined ? null : Number(v); }
  return out;
}
const SETTING_GROUPS = [['chasse', 'explore', 'Chasse'], ['combat', 'swords', 'Combat'], ['progression', 'trending_up', 'Progression'], ['vente', 'sell', 'Vente'], ['planning', 'schedule', 'Planning'], ['alertes', 'notifications', 'Alertes']];
function renderSettings(el) {
  const b = current(), s = b?.state || {}, o = s.options || {}, running = b?.meta.running;
  try { store.setTab ||= localStorage.getItem('dbot-settings') || 'chasse'; } catch { store.setTab ||= 'chasse'; }
  el.innerHTML = `<div class="tab settings">
    <nav class="subnav" id="set-nav">${SETTING_GROUPS.map(([id, icon, label]) => `<button type="button" class="chip${store.setTab === id ? ' on' : ''}" data-group-tab="${id}"><span class="ms">${icon}</span>${label}</button>`).join('')}</nav>
    <div class="panel card" data-group="chasse"><h3>Envoyer le bot quelque part</h3>
      <div class="row"><label class="field grow"><span>Carte (numéro) ou coordonnées</span><input type="text" id="goto" placeholder="ex. 4,-19 ou 7411" ${running ? '' : 'disabled'}></label>
        <button class="btn primary" id="goto-btn" ${running ? '' : 'disabled'}><span class="ms">near_me</span>Y aller</button>
        <button class="btn" data-action="cancel-goal" id="cancel-goal" ${running && s.goal ? '' : 'hidden'}><span class="ms">close</span>Annuler l'objectif</button></div>
      <p class="hint">Il y va en enchaînant les changements de carte, puis reprend la chasse autour. Tu peux aussi toucher une carte sur le plan, onglet Carte.</p></div>
    <div class="panel card" data-group="chasse"><h3>Réglages de chasse <span class="muted" id="range-info"></span></h3>
      <form id="opts-form">${optionInputs(o)}
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${running ? '' : 'disabled'}><span class="ms">check</span>Appliquer sans relancer</button></div></form>
      <p class="hint">Vide = réglage automatique. Facteur : il n'attaque que les groupes dont la somme des niveaux est au plus son niveau × facteur. Après une défaite il le baisse de 20 %, puis le remonte après 3 victoires de suite.</p></div>
    <div class="panel card" data-group="combat"><h3>Stratégie de combat <span class="muted" id="style-info"></span></h3>
      <form id="strategy-form">
        <div class="form-grid">
          <label class="field"><span>Style</span><select name="fightStyle">${[['auto', 'Auto : à distance s\'il a la portée, offensif sinon, prudent quand sa vie baisse'], ['offensif', 'Offensif : au contact, frappe le plus possible'], ['prudent', 'Prudent : là où il prend le moins de coups'], ['distance', 'À distance : à sa portée, hors d\'atteinte si possible']].map(([v, l]) => `<option value="${v}" ${(o.fightStyle || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Cible prioritaire</span><select name="targetPriority">${[['auto', 'Auto : ceux qui frappent fort, puis achever'], ['dangereux', 'Le plus dangereux d\'abord'], ['faible', 'Le plus faible d\'abord (achever)'], ['proche', 'Le plus proche']].map(([v, l]) => `<option value="${v}" ${(o.targetPriority || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Se soigne en priorité sous (% de vie)</span><input type="number" name="healBelow" min="0" max="100" step="5" value="${o.healBelow ?? 50}"></label>
          <label class="field"><span>Joue prudent sous (% de vie)</span><input type="number" name="fleeBelow" min="0" max="100" step="5" value="${o.fleeBelow ?? 35}"></label>
        </div>
        <div class="muted" style="font-size:13px;margin:14px 0 8px;font-weight:500">Sorts qu'il peut lancer (décoche pour interdire)</div>
        <div class="spell-checks">${spellChecks(s, o)}</div>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${running ? '' : 'disabled'}><span class="ms">check</span>Appliquer</button></div>
      </form>
      <p class="hint">À chaque tour il cherche la case d'où il fait le plus de dégâts sur tout le tour (morts comprises), en visant d'abord les monstres qui frappent le plus fort. Il lance un boost quand il rapporte plus que le sort qu'il remplace. Ensuite il se place selon le style, en tenant compte de ce que chaque monstre peut lui faire (ses sorts, ses PA et PM, sa portée).</p></div>
    <div class="panel card" data-group="chasse"><h3>Chasse ciblée et arrêts</h3>
      <form id="hunt-form">
        <div class="form-grid">
          <label class="field"><span>Ne chasser que ces monstres</span><input type="text" list="monster-list" data-list="onlyMonsters" placeholder="nom du monstre puis Entrée" autocomplete="off"></label>
          <label class="field"><span>Ne jamais attaquer ces monstres</span><input type="text" list="monster-list" data-list="avoidMonsters" placeholder="nom du monstre puis Entrée" autocomplete="off"></label>
        </div>
        <div class="monster-lists"><div><div class="muted small">Chassés</div><div class="chips" id="chips-onlyMonsters"></div></div><div><div class="muted small">Évités</div><div class="chips" id="chips-avoidMonsters"></div></div></div>
        <datalist id="monster-list"></datalist>
        <div class="form-grid">
          <label class="field"><span>Rester autour de (carte ou x,y)</span><input type="text" name="zoneCenter" placeholder="partout" value="${esc(o.zoneCenter ?? '')}"></label>
          <label class="field"><span>Rayon de la zone (cartes)</span><input type="number" name="zoneRadius" min="0" max="50" step="1" value="${o.zoneRadius ?? 3}"></label>
          <label class="field"><span>S'arrêter au niveau</span><input type="number" name="stopLevel" min="1" max="200" step="1" placeholder="jamais" value="${o.stopLevel ?? ''}"></label>
          <label class="field"><span>S'arrêter à (kamas)</span><input type="number" name="stopKamas" min="1" step="1000" placeholder="jamais" value="${o.stopKamas ?? ''}"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${running ? '' : 'disabled'}><span class="ms">check</span>Appliquer</button>
          <button class="btn" type="button" id="zone-here" ${running && s.map ? '' : 'disabled'}><span class="ms">my_location</span>Zone autour de sa carte</button></div>
      </form>
      <p class="hint">Avec une liste de monstres à chasser, il ne va que sur les cartes où ils apparaissent et n'attaque que les groupes qui en ont un, quel que soit leur niveau (toujours dans la limite du facteur). La zone compte en cartes autour du centre (coordonnées).</p></div>
    <div class="panel card" data-group="planning"><h3>Planning <span class="muted" id="plan-state"></span></h3>
      <form id="plan-form"><p class="muted" style="margin:0">Chargement…</p></form>
      <p class="hint">L'application lance ce bot au début de la plage et l'arrête à la fin (il finit son combat), avec ses derniers réglages. Une plage qui finit avant de commencer (22:00 → 06:00) passe minuit. Elle doit rester ouverte sur ce PC.</p></div>
    <div class="panel card" data-group="alertes"><h3>Alertes</h3>
      <form id="alert-form">
        <div class="form-grid">${ALERT_KINDS.map(([k, l]) => `<label class="check"><input type="checkbox" name="ev-${k}" ${alertPrefs().events[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="form-grid" style="margin-top:12px">
          <label class="check"><input type="checkbox" name="sound" ${alertPrefs().sound ? 'checked' : ''}><span>Son</span></label>
          <label class="check"><input type="checkbox" name="desktop" ${alertPrefs().desktop ? 'checked' : ''} ${'Notification' in window && window.isSecureContext ? '' : 'disabled'}><span>Notification du système${'Notification' in window && window.isSecureContext ? '' : ' (pas disponible ici)'}</span></label>
        </div>
      </form>
      ${store.info.local ? `<form id="webhook-form" style="margin-top:16px">
        <label class="field"><span>Notifications sur le téléphone, même page fermée : webhook Discord ou https://ntfy.sh/ton-sujet</span><input type="url" name="url" placeholder="https://discord.com/api/webhooks/… ou https://ntfy.sh/…"></label>
        <div class="form-grid" style="margin-top:10px">${ALERT_KINDS.map(([k, l]) => `<label class="check"><input type="checkbox" name="hook-${k}"><span>${l.replace(' (son et notification tous les 10)', '')}</span></label>`).join('')}
          <label class="field"><span>Niveaux : tous les</span><input type="number" name="levelStep" min="1" max="100" step="1" value="10"></label></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit"><span class="ms">check</span>Enregistrer</button><button class="btn" type="button" id="webhook-test"><span class="ms">notifications</span>Tester</button></div>
      </form>` : ''}
      <p class="hint">Sur cet appareil, pendant que la page est ouverte : un message (et le son si coché) à chaque évènement choisi. ${store.info.local ? 'Le webhook part de ce PC vers Discord (salon de ton serveur Discord) ou ntfy (application ntfy sur le téléphone, abonnée au même sujet).' : 'Les notifications page fermée se règlent depuis le PC.'}</p></div>
    <div class="panel card" data-group="progression"><h3>Progression</h3>
      <form id="prog-form">
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="autoBoost" ${o.autoBoost !== false ? 'checked' : ''}><span>Placer ses points de caractéristique et de sort</span></label>
          <label class="check"><input type="checkbox" name="autoEquip" ${o.autoEquip !== false ? 'checked' : ''}><span>Porter le meilleur équipement de son sac</span></label>
          <label class="check"><input type="checkbox" name="healBeforeFight" ${o.healBeforeFight !== false ? 'checked' : ''}><span>Se soigner avant chaque combat avec ses consommables</span></label>
        </div>
        <div class="form-grid" style="margin-top:12px">
          <label class="field"><span>Build (où vont les points)</span><select name="build">${[['auto', 'Auto : élément de ses sorts'], ['force', 'Force'], ['intelligence', 'Intelligence'], ['chance', 'Chance'], ['agilite', 'Agilité'], ['vitalite', 'Vitalité'], ['sagesse', 'Sagesse']].map(([v, l]) => `<option value="${v}" ${(o.build || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Réserve de pains et potions de soin</span><input type="number" name="healReserve" min="0" step="1" value="${o.healReserve ?? 30}"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${running ? '' : 'disabled'}><span class="ms">check</span>Appliquer</button></div>
      </form>
      <p class="hint">Caractéristiques (build auto) : l'élément de ses sorts qui frappera le plus fort une fois tout le capital des niveaux à venir dépensé aux coûts de sa classe, sans s'éparpiller entre plusieurs éléments. Points de sort : sur ses sorts d'attaque de cet élément, ceux qu'il lance le plus d'abord, là où ils ajoutent le plus de dégâts par point. Équipement : l'objet qui le rend le plus fort, mesuré sur ses vrais sorts (dégâts du meilleur tour que ses PA permettent, élément, % et dommages fixes, PM, portée, vie). Il garde les objets qu'il pourra porter dans quelques niveaux s'ils le rendent plus fort.</p></div>
    <div class="panel card" data-group="vente"><h3>Hôtel de vente</h3>
      <form id="sell-form">
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="autoSell" ${o.autoSell !== false ? 'checked' : ''}><span>Vente automatique</span></label>
          <label class="check"><input type="checkbox" name="keepHeal" ${o.keepHeal !== false ? 'checked' : ''}><span>Garder pains et potions de soin</span></label>
          <label class="check"><input type="checkbox" name="dropJunk" ${o.dropJunk !== false ? 'checked' : ''}><span>Sac et HDV pleins : jeter ce qui vaut le moins</span></label>
        </div>
        <div class="form-grid" style="margin-top:12px">
          <label class="field"><span>Passage à l'HDV tous les (combats)</span><input type="number" name="sellEvery" min="1" step="1" value="${o.sellEvery ?? 5}"></label>
          <label class="field"><span>Prix (% de la référence)</span><input type="number" name="sellMarkup" min="10" step="5" value="${o.sellMarkup ?? 100}"></label>
          <label class="field"><span>Prix minimum (kamas l'unité)</span><input type="number" name="sellMin" min="1" step="1" value="${o.sellMin ?? 1}"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${running ? '' : 'disabled'}><span class="ms">check</span>Appliquer</button>
          <button class="btn" type="button" data-action="sell" ${running ? '' : 'disabled'}><span class="ms">sell</span>Vendre maintenant</button></div>
      </form>
      <p class="hint">Il ouvre l'hôtel de vente Draco (.vendre) et met tout son butin en lots de 1, 10 ou 100, le plus cher d'abord. Prix : un équipement vaut à peu près son prix de base (jusqu'à ×1,5 s'il se vend plus cher, plus pour un jet parfait ou un exo PA/PM), une ressource son prix moyen plafonné selon son niveau ; un peu moins que l'offre la moins chère des autres vendeurs. Les annonces deux fois trop chères sont reprises et remises au bon prix. HDV plein (3000 annonces par compte sur l'HDV universel) : un objet qui vaut au moins le double prend la place de l'annonce la moins chère. Il ne vend jamais ce qu'il porte, les objets liés ni ceux que tu gardes (onglet Sac).</p></div>
    <div class="panel card" data-group="planning"><h3>Arrêt</h3>
      <div class="row"><button class="btn danger" data-action="stop" ${running ? '' : 'disabled'}><span class="ms">stop</span>Arrêter (après son combat)</button>
        <button class="btn danger" data-action="kill" ${running ? '' : 'disabled'}><span class="ms">power_settings_new</span>Arrêt immédiat</button></div></div>
  </div>`;
  $('#goto-btn').addEventListener('click', () => { const v = $('#goto').value.trim(); if (v) sendGoto(v); });
  $('#goto').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#goto-btn').click(); } });
  $('#opts-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options: readOptions(e.target)}}); toast('Réglages appliqués.'); }
    catch (x) { toast(x.message, true); }
  });
  $('#prog-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, reserve = f.elements.healReserve.value.trim();
    const options = {autoBoost: f.elements.autoBoost.checked, autoEquip: f.elements.autoEquip.checked, healBeforeFight: f.elements.healBeforeFight.checked, build: f.elements.build.value, healReserve: reserve === '' ? null : Number(reserve)};
    try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options}}); toast('Réglages de progression appliqués.'); }
    catch (x) { toast(x.message, true); }
  });
  $('#sell-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, num = name => { const v = f.elements[name].value.trim(); return v === '' ? null : Number(v); };
    const options = {autoSell: f.elements.autoSell.checked, keepHeal: f.elements.keepHeal.checked, dropJunk: f.elements.dropJunk.checked, sellEvery: num('sellEvery'), sellMarkup: num('sellMarkup'), sellMin: num('sellMin')};
    try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options}}); toast('Réglages de vente appliqués.'); }
    catch (x) { toast(x.message, true); }
  });
  const showGroup = () => el.querySelectorAll('[data-group]').forEach(c => { c.hidden = c.dataset.group !== store.setTab; });
  showGroup();
  $('#set-nav').addEventListener('click', e => {
    const tab = e.target.closest('[data-group-tab]');
    if (!tab) return;
    store.setTab = tab.dataset.groupTab;
    try { localStorage.setItem('dbot-settings', store.setTab); } catch {}
    $('#set-nav').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === tab));
    showGroup();
  });
  wireStrategy(b);
  wireHunt(b, o);
  loadPlan(b);
  wireAlerts();
  updateSettingsInfo(b);
}

/** Checkboxes of the spells it may cast (unchecked = forbidden), its weapon as id 0. */
function spellChecks(s, o) {
  const spells = sheetOf(s)?.spells || [];
  if (!spells.length) return '<p class="muted" style="margin:0">La liste de ses sorts arrive dès qu\'il est en jeu.</p>';
  const banned = new Set(o.bannedSpells || []), weapon = sheetOf(s)?.equipment?.find(e => e.slot === 1);
  const list = [...spells.map(sp => [sp.id, `${sp.name} ${sp.level}`]), ...(weapon ? [[0, `Arme : ${weapon.name}`]] : [])];
  return list.map(([id, label]) => `<label class="check"><input type="checkbox" data-spell="${id}" ${banned.has(id) ? '' : 'checked'}><span>${esc(label)}</span></label>`).join('');
}
function wireStrategy(b) {
  $('#strategy-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, num = name => { const v = f.elements[name].value.trim(); return v === '' ? null : Number(v); };
    const options = {fightStyle: f.elements.fightStyle.value, targetPriority: f.elements.targetPriority.value, healBelow: num('healBelow'), fleeBelow: num('fleeBelow')};
    const boxes = [...f.querySelectorAll('[data-spell]')];
    if (boxes.length) options.bannedSpells = boxes.filter(x => !x.checked).map(x => Number(x.dataset.spell));
    try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options}}); toast('Stratégie appliquée.'); }
    catch (x) { toast(x.message, true); }
  });
}

/** Monsters to hunt or to avoid: name autocompletion (all the monsters of the game), chips to remove them. */
async function wireHunt(b, o) {
  const lists = {onlyMonsters: [...(o.onlyMonsters || [])], avoidMonsters: [...(o.avoidMonsters || [])]};
  if (!store.monsters) store.monsters = (await api('/api/monsters').catch(() => ({monsters: []}))).monsters;
  const byId = new Map(store.monsters.map(m => [m.id, m]));
  const label = m => `${m.name} (niv. ${m.min}${m.max !== m.min ? `-${m.max}` : ''})`;
  const dl = $('#monster-list');
  if (!dl) return;
  dl.innerHTML = store.monsters.map(m => `<option value="${esc(label(m))}"></option>`).join('');
  const draw = () => {
    for (const key of Object.keys(lists)) {
      const el = $(`#chips-${key}`);
      if (el) el.innerHTML = lists[key].length ? lists[key].map(id => `<button type="button" class="chip on" data-remove="${key}:${id}">${esc(byId.get(id)?.name || `#${id}`)} ×</button>`).join('') : '<span class="muted small">aucun</span>';
    }
  };
  draw();
  const form = $('#hunt-form');
  form.addEventListener('click', e => {
    const r = e.target.closest('[data-remove]')?.dataset.remove;
    if (!r) return;
    const [key, id] = r.split(':');
    lists[key] = lists[key].filter(x => x !== Number(id));
    draw();
  });
  for (const input of form.querySelectorAll('[data-list]')) {
    const add = () => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      const m = store.monsters.find(x => label(x).toLowerCase() === v) || store.monsters.find(x => x.name.toLowerCase() === v) || store.monsters.find(x => x.name.toLowerCase().startsWith(v));
      if (!m) return toast('Monstre inconnu.', true);
      const key = input.dataset.list;
      if (!lists[key].includes(m.id)) lists[key].push(m.id);
      input.value = '';
      draw();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    input.addEventListener('change', add);
  }
  $('#zone-here')?.addEventListener('click', () => { const map = current()?.state?.map; if (map) form.elements.zoneCenter.value = `${map.x},${map.y}`; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, num = name => { const v = f.elements[name].value.trim(); return v === '' ? null : Number(v); };
    const options = {...lists, zoneCenter: f.elements.zoneCenter.value.trim() || null, zoneRadius: num('zoneRadius'), stopLevel: num('stopLevel'), stopKamas: num('stopKamas')};
    try { await api(`/api/bots/${encodeURIComponent(b.meta.key)}/set`, {method: 'POST', body: {options}}); toast('Chasse ciblée appliquée.'); }
    catch (x) { toast(x.message, true); }
  });
}

/** Days and hours when the app runs this bot by itself. */
async function loadPlan(b) {
  const form = $('#plan-form');
  if (!form) return;
  const character = nameOf(b);
  const data = await api('/api/schedules').catch(() => ({schedules: []}));
  if (!$('#plan-form')) return;
  const sc = data.schedules.find(x => x.account.toLowerCase() === b.meta.account.toLowerCase()) || {enabled: false, days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '23:00', character};
  const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  form.innerHTML = `<label class="check"><input type="checkbox" name="enabled" ${sc.enabled ? 'checked' : ''}><span>Lancer et arrêter ${esc(sc.character || character)} tout seul</span></label>
    <div class="days">${DAYS.map((d, i) => `<label class="day"><input type="checkbox" name="day" value="${i + 1}" ${sc.days.includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
    <div class="form-grid"><label class="field"><span>De</span><input type="time" name="start" value="${sc.start}"></label><label class="field"><span>À</span><input type="time" name="end" value="${sc.end}"></label></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit"><span class="ms">schedule</span>Enregistrer</button></div>`;
  const state = $('#plan-state');
  if (state) state.textContent = sc.enabled ? (sc.open ? '· plage en cours' : '· en attente de la plage') + (sc.lastError ? ` · dernier lancement refusé : ${sc.lastError}` : '') : '';
  form.onsubmit = async e => {
    e.preventDefault();
    const days = [...form.querySelectorAll('[name="day"]:checked')].map(x => Number(x.value));
    try {
      await api('/api/schedules', {method: 'POST', body: {account: b.meta.account, character: sc.character || character, enabled: form.elements.enabled.checked, days, start: form.elements.start.value, end: form.elements.end.value}});
      toast(form.elements.enabled.checked ? 'Planning enregistré.' : 'Planning désactivé.');
      loadPlan(b);
    } catch (x) { toast(x.message, true); }
  };
}

function wireAlerts() {
  const form = $('#alert-form');
  form?.addEventListener('change', async e => {
    const prefs = alertPrefs();
    for (const [k] of ALERT_KINDS) prefs.events[k] = form.elements[`ev-${k}`].checked;
    prefs.sound = form.elements.sound.checked;
    prefs.desktop = form.elements.desktop.checked;
    if (prefs.desktop && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { prefs.desktop = false; form.elements.desktop.checked = false; toast('Notifications refusées par le navigateur.', true); }
    }
    if (e.target.name === 'sound' && prefs.sound) beep(false);
    saveAlertPrefs(prefs);
  });
  const hook = $('#webhook-form');
  if (!hook) return;
  api('/api/alerts').then(a => {
    hook.elements.url.value = a.url || '';
    for (const [k] of ALERT_KINDS) hook.elements[`hook-${k}`].checked = !!a.events?.[k];
    hook.elements.levelStep.value = a.levelStep || 10;
  }).catch(() => {});
  hook.addEventListener('submit', async e => {
    e.preventDefault();
    const events = Object.fromEntries(ALERT_KINDS.map(([k]) => [k, hook.elements[`hook-${k}`].checked]));
    try { await api('/api/alerts', {method: 'POST', body: {url: hook.elements.url.value.trim(), events, levelStep: Number(hook.elements.levelStep.value) || 10}}); toast('Notifications enregistrées.'); }
    catch (x) { toast(x.message, true); }
  });
  $('#webhook-test').addEventListener('click', async () => {
    try { await api('/api/alerts/test', {method: 'POST', body: {}}); toast('Notification de test envoyée.'); }
    catch (x) { toast(x.message, true); }
  });
}
function updateSettingsInfo(b) {
  const s = b.state || {};
  const style = $('#style-info');
  if (style) style.textContent = s.zone ? `zone : ${s.zone.label} (rayon ${s.zone.radius})` : '';
  const info = $('#range-info');
  if (info) info.textContent = s.range ? `en ce moment : cartes de niveau ${s.range.minLevel} à ${s.range.maxLevel}, facteur ${String(s.factorNow ?? '').replace('.', ',')}` : '';
  const cancel = $('#cancel-goal');
  if (cancel) cancel.hidden = !(b.meta.running && s.goal);
}

// --- New bot ----------------------------------------------------------------------------------------------------------
async function openNew() {
  const dlg = $('#dlg-new'), body = $('#new-body');
  body.innerHTML = '<p class="muted">Chargement des comptes…</p>';
  dlg.showModal();
  let data;
  try { data = await api('/api/accounts'); } catch (x) { body.innerHTML = `<div class="notice bad">${esc(x.message)}</div>`; return; }
  store.accounts = data.accounts;
  if (!data.accounts.length) {
    body.innerHTML = `<div class="notice">Aucun compte n'est encore réservé au bot.${store.info.local ? ' Crée-en un ou ajoute un compte existant.' : ' Ajoute-en un depuis le PC (menu Comptes).'}</div>
      ${store.info.local ? '<button class="btn primary" type="button" id="new-to-accounts"><span class="ms">group_add</span>Gérer les comptes</button>' : ''}`;
    $('#new-to-accounts')?.addEventListener('click', () => { dlg.close(); openAccounts(); });
    $('#new-submit').disabled = true;
    return;
  }
  const usable = data.accounts.filter(a => !a.missing && !a.bot); // one bot per account
  if (!usable.length) {
    body.innerHTML = `<div class="notice">Chaque compte du bot a déjà un bot en cours (un bot par compte).${store.info.local ? ' Crée un autre compte pour lancer un bot de plus.' : ' Crée un autre compte depuis le PC (menu Comptes).'}</div>
      ${store.info.local ? '<button class="btn primary" type="button" id="new-to-accounts"><span class="ms">group_add</span>Gérer les comptes</button>' : ''}`;
    $('#new-to-accounts')?.addEventListener('click', () => { dlg.close(); openAccounts(); });
    $('#new-submit').disabled = true;
    return;
  }
  $('#new-submit').disabled = false;
  body.innerHTML = `<label class="field"><span>Compte</span><select id="new-account">${usable.map(a => `<option value="${esc(a.login)}">${esc(a.login)}${a.draco && !a.app ? ' · compte Draco' : ''}${a.logged ? ' (un personnage est en jeu)' : ''}</option>`).join('')}</select></label>
    <div><div class="muted" style="font-size:13px;margin-bottom:6px;font-weight:500">Personnage</div><div class="chars" id="new-chars"></div></div>
    <div id="new-create" hidden>
      <div class="form-grid"><label class="field"><span>Nom du nouveau personnage</span><input type="text" id="new-name" placeholder="3 à 20 lettres" maxlength="20"></label>
        <label class="field"><span>Sexe</span><select id="new-sex"><option value="0">Masculin</option><option value="1">Féminin</option></select></label></div>
      <div class="class-pick" style="margin-top:10px">${CLASS_KEYS.map((k, i) => `<label><input type="radio" name="new-class" value="${k}" ${k === 'iop' ? 'checked' : ''}><img src="${classIcon(i + 1)}" alt="">${CLASS_NAMES[i + 1]}</label>`).join('')}</div>
    </div>
    <label class="check"><input type="checkbox" id="new-sell" checked><span>Mettre son butin en vente à l'hôtel de vente (tous les 5 combats)</span></label>
    <details class="more" id="new-more"><summary>Réglages (facultatifs)</summary>
      <label class="field" style="margin-bottom:12px"><span>Aller d'abord à (carte ou coordonnées)</span><input type="text" id="new-goal" placeholder="ex. 4,-19"></label>
      <div id="new-opts">${optionInputs({}, 'new')}</div></details>`;
  const pick = () => {
    const acc = usable.find(a => a.login === $('#new-account').value) || usable[0];
    const chars = acc?.characters || [];
    $('#new-chars').innerHTML = chars.map((c, i) => `<label class="char${c.logged ? ' disabled' : ''}" title="${c.logged ? 'connecté en jeu' : ''}"><input type="radio" name="new-char" value="${esc(c.name)}" ${i === 0 && !c.logged ? 'checked' : ''} ${c.logged ? 'disabled' : ''}>
        <img src="${classIcon(c.classId, c.sex)}" alt=""><div style="min-width:0"><div class="cname">${esc(c.name)}</div><div class="cinfo">${CLASS_NAMES[c.classId] || ''} niv. ${c.level}${c.x !== null ? ` · [${c.x},${c.y}]` : ''}${c.logged ? ' · en jeu' : ''}</div></div></label>`).join('')
      + `<label class="char"><input type="radio" name="new-char" value="" ${chars.length ? '' : 'checked'}><div class="avatar" style="width:40px;height:40px"><span class="ms">person_add</span></div><div><div class="cname">Nouveau personnage</div><div class="cinfo">créé par le bot</div></div></label>`;
    sync();
  };
  const sync = () => {
    const name = $('input[name="new-char"]:checked')?.value ?? '';
    $('#new-create').hidden = name !== '';
    const acc = usable.find(a => a.login === $('#new-account').value);
    const preset = acc?.characters.find(c => c.name === name)?.preset || {};
    $('#new-goal').value = preset.goal || '';
    $('#new-sell').checked = preset.autoSell !== false;
    $('#new-opts').innerHTML = optionInputs(preset, 'new');
  };
  $('#new-account').addEventListener('change', pick);
  $('#new-chars').addEventListener('change', sync);
  pick();
}
$('#new-form').addEventListener('submit', async e => {
  e.preventDefault();
  const account = $('#new-account')?.value;
  if (!account) return;
  const chosen = $('input[name="new-char"]:checked')?.value ?? '';
  const create = chosen === '' ? {classe: $('input[name="new-class"]:checked')?.value, female: $('#new-sex').value === '1'} : null;
  const character = chosen || $('#new-name').value.trim();
  const acc = store.accounts?.find(a => a.login === account);
  const preset = acc?.characters.find(c => c.name === chosen)?.preset || {};
  const options = {...preset, ...readOptions($('#new-body'), 'new'), goal: $('#new-goal').value.trim() || null, autoSell: $('#new-sell').checked};
  try {
    store.pendingSelect = account.toLowerCase();
    await api('/api/bots', {method: 'POST', body: {account, character, create, options}});
    $('#dlg-new').close();
    store.tab = 'carte';
    toast(`Bot lancé sur ${character}.`);
  } catch (x) { toast(x.message, true); }
});
$('#btn-new').addEventListener('click', openNew);
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close(); });

// --- Accounts (this PC only) -----------------------------------------------------------------------------------------
async function openAccounts() {
  const dlg = $('#dlg-accounts'), body = $('#accounts-body');
  if (!dlg.open) dlg.showModal();
  body.innerHTML = '<p class="muted">Chargement…</p>';
  const {accounts} = await api('/api/accounts').catch(x => { body.innerHTML = `<div class="notice bad">${esc(x.message)}</div>`; return {accounts: null}; });
  if (!accounts) return;
  body.innerHTML = `<p class="muted" style="margin:0">Le bot ne peut jouer que sur ces comptes. Un compte utilisé par un bot ne doit pas être ouvert en même temps dans le jeu.</p>
    <div class="list">${accounts.length ? accounts.map(a => `<div class="item"><div><b>${esc(a.login)}</b>${a.draco ? ' <span class="tag eq">compte Draco</span>' : ''} <span class="muted">${a.missing ? 'introuvable sur le serveur' : `${a.characters.length} personnage(s)${a.characters.length ? ` : ${esc(a.characters.map(c => `${c.name} ${c.level}`).join(', '))}` : ''}`}</span></div>
      ${a.app ? `<button class="btn small danger" data-remove="${esc(a.login)}"><span class="ms">remove</span>Retirer</button>` : ''}</div>`).join('') : '<p class="muted" style="margin:0">Aucun compte pour l\'instant.</p>'}</div>
    <p class="hint">Les comptes marqués « compte Draco » viennent du compte Draco connecté (bouton Compte Draco) : ils se gèrent sur le site.</p>
    <form id="acc-create" class="panel card" style="box-shadow:none"><h3>Créer un compte pour un bot</h3>
      <div class="form-grid"><label class="field"><span>Identifiant</span><input type="text" name="login" placeholder="ex. bot-chasseur" required maxlength="20"></label>
        <label class="field"><span>Pseudo</span><input type="text" name="pseudo" placeholder="ex. Chasseur" required maxlength="20"></label></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="submit"><span class="ms">person_add</span>Créer</button></div>
      <p class="hint">Même compte que ceux du launcher (abonnement actif). Le personnage se crée ensuite dans « Nouveau bot ».</p><div id="acc-result"></div></form>
    <form id="acc-add" class="panel card" style="box-shadow:none"><h3>Ajouter un compte existant</h3>
      <div class="row"><label class="field grow"><span>Identifiant du compte</span><input type="text" name="login" required maxlength="20"></label><button class="btn" type="submit"><span class="ms">add</span>Ajouter</button></div>
      <p class="hint">Attention : le bot déconnecte quiconque joue sur ce compte. N'ajoute que des comptes à toi.</p></form>`;
  body.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`Retirer ${btn.dataset.remove} des comptes du bot ? (le compte reste sur le serveur)`)) return;
    await api(`/api/accounts/${encodeURIComponent(btn.dataset.remove)}`, {method: 'DELETE', body: {}}).catch(x => toast(x.message, true));
    openAccounts();
  }));
  $('#acc-create').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('/api/accounts/create', {method: 'POST', body: {login: f.get('login'), pseudo: f.get('pseudo')}});
      await openAccounts();
      $('#acc-result').innerHTML = `<div class="notice" style="margin-top:10px">Compte <b>${esc(r.login)}</b> créé. Mot de passe (pour l'ouvrir dans le jeu, affiché une seule fois) : <b>${esc(r.password)}</b></div>`;
    } catch (x) { toast(x.message, true); }
  });
  $('#acc-add').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/accounts', {method: 'POST', body: {login: new FormData(e.target).get('login')}}); openAccounts(); }
    catch (x) { toast(x.message, true); }
  });
}
$('#btn-accounts').addEventListener('click', openAccounts);

// --- Draco web account -------------------------------------------------------------------------------------------------
async function openDraco() {
  const dlg = $('#dlg-draco'), body = $('#draco-body');
  if (!dlg.open) dlg.showModal();
  const master = store.info.master;
  if (master) {
    body.innerHTML = '<p class="muted">Chargement…</p>';
    const {accounts} = await api('/api/accounts').catch(() => ({accounts: []}));
    const mine = accounts.filter(a => a.draco);
    body.innerHTML = `<p style="margin:0">Connecté avec <b>${esc(master.email)}</b>.</p>
      <div class="list">${mine.length ? mine.map(a => `<div class="item"><div><b>${esc(a.login)}</b> <span class="muted">${a.missing ? 'introuvable sur le serveur' : `${a.characters.length} personnage(s)${a.characters.length ? ` : ${esc(a.characters.map(c => `${c.name} ${c.level}`).join(', '))}` : ''}`}${a.bot ? ' · bot en cours' : ''}</span></div></div>`).join('') : '<p class="muted" style="margin:0">Aucun compte de jeu n\'est lié à ce compte Draco (ça se fait sur le site, page Mon compte).</p>'}</div>
      <p class="hint">Tu peux lancer un bot sur chacun de ces comptes (bouton Nouveau bot). Attention : un compte où quelqu'un joue ne peut pas recevoir de bot, et lancer un bot sur un compte que tu utilises en jeu te déconnecterait.</p>
      <div class="row"><button class="btn danger" type="button" id="draco-out"><span class="ms">logout</span>Se déconnecter du compte Draco</button></div>`;
    $('#draco-out').addEventListener('click', async () => {
      await api('/api/logout', {method: 'POST', body: {}}).catch(() => {});
      if (!store.info.local) return location.reload();
      store.info = await fetch('/api/info', {credentials: 'same-origin'}).then(r => r.json());
      dlg.close();
      showApp();
      toast('Compte Draco déconnecté de ce PC.');
    });
    return;
  }
  body.innerHTML = `<form id="draco-form" class="login-form" style="text-align:left">
      <p class="muted" style="margin:0">Connecte ton compte Draco (site et launcher) : ses comptes de jeu s'ajoutent à ceux du bot sur ce PC.</p>
      <label class="field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" required></label>
      <div class="row"><button class="btn primary" type="submit"><span class="ms">login</span>Se connecter</button></div>
      <p class="muted" id="draco-error" style="color:var(--bad);margin:0" hidden></p></form>`;
  $('#draco-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('#draco-error');
    try {
      await api('/api/login', {method: 'POST', body: {email: f.get('email'), password: f.get('password')}});
      store.info = await fetch('/api/info', {credentials: 'same-origin'}).then(r => r.json());
      showApp();
      openDraco();
      toast(`Compte Draco ${store.info.master?.email || ''} connecté.`);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
}
$('#btn-draco').addEventListener('click', openDraco);

// --- Phone (this PC only) --------------------------------------------------------------------------------------------
let qrLib;
const loadQr = () => (qrLib ||= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  s.onload = () => resolve(window.qrcode);
  s.onerror = () => { qrLib = null; reject(Error('QR indisponible hors ligne')); };
  document.head.append(s);
}));
async function openPhone() {
  const dlg = $('#dlg-phone'), body = $('#phone-body');
  store.info = await fetch('/api/info', {credentials: 'same-origin'}).then(r => r.json()).catch(() => store.info);
  if (store.info.extension) return openPhoneSite(dlg, body);
  const addresses = store.info.addresses || [];
  body.innerHTML = `<div class="notice">Mot de passe à taper sur le téléphone : <b style="font-size:16px">${esc(store.info.password || '')}</b></div>
    <div class="addr">${addresses.length ? addresses.map((a, i) => `<div class="item"><div class="muted" style="font-size:12.5px;font-weight:600">${esc(a.kind)}</div><code>${esc(a.url)}</code><div class="qr" id="qr-${i}"></div></div>`).join('') : '<div class="notice bad">Aucune adresse réseau trouvée.</div>'}</div>
    <p class="hint" style="margin:0">Le téléphone doit être sur le même Wi-Fi que ce PC. L'adresse Tailscale marche partout si Tailscale est installé sur le téléphone.</p>
    <form id="pw-form" class="row"><label class="field grow"><span>Nouveau mot de passe</span><input type="text" name="password" minlength="6" required autocomplete="off"></label><button class="btn" type="submit">Changer</button></form>`;
  if (!dlg.open) dlg.showModal();
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/password', {method: 'POST', body: {password: new FormData(e.target).get('password')}}); toast('Mot de passe changé : les téléphones devront se reconnecter.'); openPhone(); }
    catch (x) { toast(x.message, true); }
  });
  try {
    const qrcode = await loadQr();
    addresses.forEach((a, i) => { const qr = qrcode(0, 'M'); qr.addData(a.url); qr.make(); const el = $(`#qr-${i}`); if (el) el.innerHTML = qr.createSvgTag(5, 8); });
  } catch { addresses.forEach((a, i) => { const el = $(`#qr-${i}`); if (el) el.remove(); }); }
}
/** Launcher extension: the phone goes through the Draco site, signed in with the same Draco account. */
async function openPhoneSite(dlg, body) {
  const url = store.info.extension.phone || '';
  body.innerHTML = `<p style="margin:0">Sur ton téléphone, ouvre cette page et connecte-toi avec ton compte Draco${store.info.master ? ` (<b>${esc(store.info.master.email)}</b>)` : ''} :</p>
    <div class="addr"><div class="item"><code>${esc(url)}</code><div class="qr" id="qr-site"></div></div></div>
    <p class="hint" style="margin:0">Ça marche partout (Wi-Fi ou 4G) tant que ce PC est allumé et que le Bot Draco tourne : le site Draco relaie les commandes.</p>`;
  if (!dlg.open) dlg.showModal();
  try { const qrcode = await loadQr(); const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('#qr-site').innerHTML = qr.createSvgTag(5, 8); } catch { $('#qr-site')?.remove(); }
}
$('#btn-phone').addEventListener('click', openPhone);

boot();
