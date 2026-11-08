'use strict';

/* Menti – Oberfläche. Fragt den Server alle paar Sekunden nach Änderungen (nur Versionsnummer, 204 wenn gleich). */

const MAX_LEN = 300;
const POLL_MS = 3000;

const ICON = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3c-.3 0-.6-.1-.8-.3C6 15.6 2.8 12.6 2.8 8.9 2.8 6 5 3.8 7.8 3.8c1.7 0 3.2.8 4.2 2.2 1-1.4 2.5-2.2 4.2-2.2 2.8 0 5 2.2 5 5.1 0 3.7-3.2 6.7-8.4 11.1-.2.2-.5.3-.8.3z"/></svg>',
  check: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle class="ring" cx="13" cy="13" r="11"/><path class="tick" d="m8.2 13.4 3.2 3.2 6.4-6.8"/></svg>',
  tick: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mark: '<svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 4 4 8-8.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bubble: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M28 9C16.4 9 7 16.8 7 26.4c0 5.5 3.1 10.4 7.9 13.6-.4 2.6-1.7 5.2-3.6 7.2 4.1-.2 8-1.8 10.6-4 2 .5 4 .8 6.1.8 11.6 0 21-7.8 21-17.4S39.6 9 28 9z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M24.3 22.2a3.9 3.9 0 1 1 5.6 3.5c-1.2.6-1.9 1.4-1.9 2.6v.7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="28" cy="33.4" r="1.8" fill="currentColor"/></svg>',
  done: '<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="20" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="m19.5 28.6 6 6 11.5-12.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#list'), empty: $('#empty'), emptyIcon: $('#emptyIcon'), emptyTitle: $('#emptyTitle'), emptyText: $('#emptyText'),
  loading: $('#loading'), sectionHeader: $('#sectionHeader'), segmented: $('#segmented'),
  countOpen: $('#countOpen'), countDone: $('#countDone'), sortBtn: $('#sortBtn'), adminBtn: $('#adminBtn'),
  adminBanner: $('#adminBanner'), offline: $('#offline'), largeTitle: $('#largeTitle'),
  composer: $('#composer'), input: $('#input'), send: $('#send'), counter: $('#counter'), hud: $('#hud'),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* privat */ } },
};

function randomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a); // funktioniert auch ohne HTTPS (crypto.randomUUID nicht)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const state = {
  clientId: store.get('menti.client') || (() => { const id = randomId(); store.set('menti.client', id); return id; })(),
  token: store.get('menti.admin'),
  questions: [],
  version: null,
  loaded: false,
  tab: 'open',
  sort: store.get('menti.sort') === 'new' ? 'new' : 'top',
  pendingLikes: new Map(),
  sending: false,
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (id) => state.questions.find((q) => q.id === id);
const isAdmin = () => !!state.token;

// ---------------------------------------------------------------- Server

async function api(method, path, body) {
  const headers = { 'X-Client-Id': state.clientId };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('api/' + path, {
      method, headers, cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new Error('Keine Verbindung zum Server.');
    err.status = 0;
    throw err;
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Unbekannter Fehler (' + res.status + ').');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let refreshing = null;
let pollTimer = null;

function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await api('GET', 'questions' + (state.version != null ? '?since=' + state.version : ''));
      if (data) {
        state.version = data.version;
        state.questions = data.questions;
        applyPendingLikes();
        render({ animate: state.loaded });
        state.loaded = true;
      }
      els.offline.hidden = true;
    } catch {
      els.offline.hidden = false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Nach eigener Änderung: sofort neu laden (Version hat sich auf dem Server erhöht). */
function refreshNow() {
  refresh().then(() => refresh());
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => { await refresh(); schedulePoll(); }, POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { refresh(); schedulePoll(); } else clearTimeout(pollTimer);
});

function applyPendingLikes() {
  for (const [id, want] of state.pendingLikes) {
    const q = find(id);
    if (q && q.liked !== want) { q.liked = want; q.likes += want ? 1 : -1; }
  }
}

// ---------------------------------------------------------------- Darstellung

const nodes = new Map();

function relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return 'vor ' + Math.floor(s / 60) + ' Min.';
  if (s < 86400) return 'vor ' + Math.floor(s / 3600) + ' Std.';
  const d = new Date(ts);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'gestern';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

function sortedItems() {
  if (state.tab === 'open') {
    const open = state.questions.filter((q) => !q.answered);
    return state.sort === 'top'
      ? open.sort((a, b) => b.likes - a.likes || b.created - a.created)
      : open.sort((a, b) => b.created - a.created);
  }
  return state.questions.filter((q) => q.answered).sort((a, b) => b.answeredAt - a.answeredAt);
}

function render({ animate = false } = {}) {
  const openCount = state.questions.filter((q) => !q.answered).length;
  const doneCount = state.questions.length - openCount;
  els.countOpen.textContent = openCount || '';
  els.countDone.textContent = doneCount || '';
  els.loading.hidden = true;

  const items = sortedItems();
  const motion = animate && !reducedMotion.matches;

  // FLIP: alte Positionen merken
  const before = new Map();
  if (motion) for (const [id, el] of nodes) before.set(id, el.getBoundingClientRect().top);

  const keep = new Set(items.map((q) => q.id));
  for (const [id, el] of nodes) if (!keep.has(id)) { el.remove(); nodes.delete(id); }

  items.forEach((q, i) => {
    let el = nodes.get(q.id);
    const isNew = !el;
    if (isNew) { el = createCell(q.id); nodes.set(q.id, el); }
    updateCell(el, q);
    if (els.list.children[i] !== el) els.list.insertBefore(el, els.list.children[i] || null);
    if (isNew && motion) {
      el.classList.remove('appear'); void el.offsetWidth; el.classList.add('appear');
    }
  });

  if (motion) {
    for (const [id, top] of before) {
      const el = nodes.get(id);
      if (!el) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'transform .45s cubic-bezier(.25,.9,.3,1)';
        el.style.transform = '';
      }));
    }
  }

  const n = items.length;
  els.list.hidden = n === 0;
  els.empty.hidden = n > 0;
  if (state.tab === 'open') {
    els.sectionHeader.textContent = n ? `${n} ${n === 1 ? 'offene Frage' : 'offene Fragen'} · ${state.sort === 'top' ? 'beliebteste zuerst' : 'neueste zuerst'}` : '';
    els.emptyIcon.innerHTML = ICON.bubble;
    els.emptyTitle.textContent = 'Keine offenen Fragen';
    els.emptyText.textContent = doneCount ? 'Alle Fragen sind beantwortet. Stell gern eine neue!' : 'Stell die erste Frage – ganz anonym.';
  } else {
    els.sectionHeader.textContent = n ? `${n} beantwortet · zuletzt beantwortet zuerst` : '';
    els.emptyIcon.innerHTML = ICON.done;
    els.emptyTitle.textContent = 'Noch nichts beantwortet';
    els.emptyText.textContent = 'Beantwortete Fragen erscheinen hier.';
  }
  els.sortBtn.classList.toggle('invisible', state.tab !== 'open');
}

function createCell(id) {
  const el = document.createElement('article');
  el.className = 'cell';
  el.dataset.id = id;
  el.innerHTML = `
    <button class="check" type="button">${ICON.check}</button>
    <div class="cell-main"><p class="q-text"></p><p class="q-meta"></p></div>
    <button class="like" type="button">${ICON.heart}<span class="like-count"></span></button>`;
  el.querySelector('.like').addEventListener('click', (e) => { e.stopPropagation(); toggleLike(id); });
  el.querySelector('.check').addEventListener('click', (e) => {
    e.stopPropagation();
    const q = find(id);
    if (q) setAnswered(id, !q.answered);
  });
  el.addEventListener('click', () => { if (isAdmin()) adminMenu(id); });
  el.addEventListener('keydown', (e) => {
    if (isAdmin() && e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); adminMenu(id); }
  });
  return el;
}

function updateCell(el, q) {
  el.querySelector('.q-text').textContent = q.text;

  const meta = el.querySelector('.q-meta');
  meta.replaceChildren();
  if (q.answered) {
    const s = document.createElement('span');
    s.className = 'tag-done';
    s.innerHTML = ICON.tick;
    s.append('Beantwortet');
    meta.append(s);
  }
  if (q.own) {
    const s = document.createElement('span');
    s.className = 'tag-own';
    s.textContent = 'Deine Frage';
    meta.append(s);
  }
  const t = document.createElement('span');
  t.textContent = relTime(q.answered ? q.answeredAt : q.created);
  meta.append(t);

  const like = el.querySelector('.like');
  like.classList.toggle('liked', q.liked);
  like.setAttribute('aria-pressed', String(q.liked));
  like.setAttribute('aria-label', `${q.liked ? 'Like entfernen' : 'Liken'} (${q.likes} ${q.likes === 1 ? 'Like' : 'Likes'})`);
  el.querySelector('.like-count').textContent = q.likes;

  const check = el.querySelector('.check');
  check.setAttribute('aria-label', q.answered ? 'Wieder als offen markieren' : 'Als beantwortet markieren');
  el.classList.toggle('answered', q.answered);
  el.tabIndex = isAdmin() ? 0 : -1;
}

function refreshTimes() {
  for (const [id, el] of nodes) { const q = find(id); if (q) updateCell(el, q); }
}
setInterval(refreshTimes, 30000);

function highlight(id) {
  requestAnimationFrame(() => {
    const el = nodes.get(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
}

function setTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  els.segmented.dataset.index = tab === 'open' ? '0' : '1';
  for (const b of els.segmented.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  render();
}

for (const b of els.segmented.querySelectorAll('button')) b.addEventListener('click', () => setTab(b.dataset.tab));

// Großer Titel klappt in die Leiste ein
new IntersectionObserver(([e]) => document.body.classList.toggle('scrolled', !e.isIntersecting), {
  rootMargin: '-48px 0px 0px 0px',
}).observe(els.largeTitle);

// ---------------------------------------------------------------- Liken

async function toggleLike(id) {
  const q = find(id);
  if (!q) return;
  const want = !q.liked;
  q.liked = want;
  q.likes += want ? 1 : -1;
  state.pendingLikes.set(id, want);
  const el = nodes.get(id);
  if (el) {
    updateCell(el, q);
    if (want) { const b = el.querySelector('.like'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }
  if (want && navigator.vibrate) navigator.vibrate(8);
  try {
    const res = await api('POST', `questions/${encodeURIComponent(id)}/like`, { liked: want });
    if (state.pendingLikes.get(id) === want) state.pendingLikes.delete(id);
    const cur = find(id);
    if (cur && !state.pendingLikes.has(id)) { Object.assign(cur, res); const e2 = nodes.get(id); if (e2) updateCell(e2, cur); }
    refreshNow();
  } catch (err) {
    if (state.pendingLikes.get(id) === want) state.pendingLikes.delete(id);
    const cur = find(id);
    if (cur && cur.liked === want) { cur.liked = !want; cur.likes += want ? -1 : 1; const e2 = nodes.get(id); if (e2) updateCell(e2, cur); }
    if (err.status === 404) refreshNow();
    else showAlert('Like nicht gespeichert', err.message);
  }
}

// ---------------------------------------------------------------- Fragen stellen

function autosize() {
  const t = els.input;
  t.style.height = '40px';
  t.style.height = Math.min(t.scrollHeight, 136) + 'px';
}

function updateComposer() {
  const len = [...els.input.value].length;
  const left = MAX_LEN - len;
  els.counter.textContent = left <= 50 ? String(left) : '';
  els.counter.className = 'counter' + (left < 0 ? ' over' : left <= 20 ? ' warn' : '');
  els.send.disabled = state.sending || !els.input.value.trim() || left < 0;
}

els.input.addEventListener('input', () => { autosize(); updateComposer(); });
els.input.addEventListener('keydown', (e) => {
  // Am Rechner: Enter sendet, Umschalt+Enter = neue Zeile. Am Handy macht Enter eine neue Zeile.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.sending) return;
  state.sending = true;
  updateComposer();
  try {
    const q = await api('POST', 'questions', { text });
    els.input.value = '';
    autosize();
    els.input.blur();
    if (!find(q.id)) state.questions.push(q);
    setTab('open');
    render({ animate: true });
    highlight(q.id);
    hud('Gesendet');
    refreshNow();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.id) {
      els.input.value = '';
      autosize();
      els.input.blur();
      await showAlert('Schon gefragt', err.message);
      await refresh();
      const q = find(err.data.id);
      if (q) { setTab(q.answered ? 'answered' : 'open'); highlight(q.id); }
    } else {
      showAlert('Nicht gesendet', err.message);
    }
  } finally {
    state.sending = false;
    updateComposer();
  }
});

new ResizeObserver(() => {
  document.documentElement.style.setProperty('--composer-h', els.composer.offsetHeight + 'px');
}).observe(els.composer);

// ---------------------------------------------------------------- Sortieren

els.sortBtn.addEventListener('click', async () => {
  const v = await actionSheet({
    title: 'Offene Fragen sortieren',
    actions: [
      { label: 'Beliebteste zuerst', value: 'top', checked: state.sort === 'top' },
      { label: 'Neueste zuerst', value: 'new', checked: state.sort === 'new' },
    ],
  });
  if (v && v !== state.sort) {
    state.sort = v;
    store.set('menti.sort', v);
    render({ animate: true });
  }
});

// ---------------------------------------------------------------- Admin

function applyAdmin() {
  document.body.classList.toggle('admin', isAdmin());
  els.adminBanner.hidden = !isAdmin();
  els.adminBtn.textContent = isAdmin() ? 'Abmelden' : 'Erstellerzugang';
  for (const el of nodes.values()) el.tabIndex = isAdmin() ? 0 : -1;
}

function dropAdmin() {
  state.token = null;
  store.del('menti.admin');
  applyAdmin();
}

async function logout() {
  try { await api('POST', 'admin/logout'); } catch { /* egal */ }
  dropAdmin();
  hud('Abgemeldet');
}

async function adminError(err, title) {
  if (err.status === 401) {
    dropAdmin();
    await showAlert('Abgemeldet', 'Die Ersteller-Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    openLogin();
  } else if (err.status === 404) {
    refreshNow();
  } else {
    showAlert(title, err.message);
  }
}

async function leaveAnimation(id) {
  const el = nodes.get(id);
  if (!el || reducedMotion.matches) return;
  el.classList.add('leave');
  await sleep(200);
  el.classList.remove('leave');
}

async function setAnswered(id, answered) {
  try {
    const res = await api('POST', `questions/${encodeURIComponent(id)}/answered`, { answered });
    await leaveAnimation(id);
    const q = find(id);
    if (q) Object.assign(q, res);
    render({ animate: true });
    hud(answered ? 'Beantwortet' : 'Wieder offen');
    refreshNow();
  } catch (err) {
    adminError(err, 'Nicht gespeichert');
  }
}

async function deleteQuestion(id) {
  try {
    await api('DELETE', `questions/${encodeURIComponent(id)}`);
    await leaveAnimation(id);
    state.questions = state.questions.filter((q) => q.id !== id);
    render({ animate: true });
    hud('Gelöscht');
    refreshNow();
  } catch (err) {
    adminError(err, 'Nicht gelöscht');
  }
}

async function adminMenu(id) {
  const q = find(id);
  if (!q) return;
  const v = await actionSheet({
    message: q.text,
    actions: [
      { label: q.answered ? 'Wieder als offen markieren' : 'Als beantwortet markieren', value: 'toggle' },
      { label: 'Frage löschen', value: 'delete', destructive: true },
    ],
  });
  if (v === 'toggle') setAnswered(id, !q.answered);
  if (v === 'delete') {
    const ok = await showAlert('Frage löschen?', 'Die Frage verschwindet für alle. Das kann nicht rückgängig gemacht werden.', [
      { label: 'Abbrechen', value: false, bold: true },
      { label: 'Löschen', value: true, destructive: true },
    ]);
    if (ok) deleteQuestion(id);
  }
}

els.adminBtn.addEventListener('click', () => (isAdmin() ? logout() : openLogin()));

function openLogin() {
  const o = overlay('form-overlay');
  o.innerHTML = `
    <form class="form-sheet" role="dialog" aria-modal="true" aria-labelledby="loginTitle" autocomplete="off">
      <div class="grabber" aria-hidden="true"></div>
      <div class="sheet-bar">
        <button class="nav-btn" type="button" data-cancel>Abbrechen</button>
        <span class="sheet-title" id="loginTitle">Erstellerzugang</span>
        <button class="nav-btn" type="submit" disabled>Anmelden</button>
      </div>
      <div class="form-group">
        <input type="password" name="password" placeholder="Passwort" aria-label="Ersteller-Passwort" autocomplete="current-password" enterkeyhint="go">
      </div>
      <p class="form-footer">Als Ersteller kannst du Fragen als beantwortet markieren und löschen.</p>
    </form>`;
  const form = o.querySelector('form');
  const input = form.querySelector('input');
  const submit = form.querySelector('[type=submit]');
  const footer = form.querySelector('.form-footer');
  const defaultFooter = footer.textContent;
  const close = trapOverlay(o, () => close());

  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
    footer.classList.remove('error');
    footer.textContent = defaultFooter;
  });
  form.querySelector('[data-cancel]').addEventListener('click', () => close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    submit.disabled = true;
    try {
      const res = await api('POST', 'admin/login', { password: input.value });
      state.token = res.token;
      store.set('menti.admin', res.token);
      applyAdmin();
      refreshTimes();
      close();
      hud('Angemeldet');
      if (location.pathname.endsWith('/admin')) history.replaceState(null, '', './');
    } catch (err) {
      footer.textContent = err.message;
      footer.classList.add('error');
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      input.select();
      submit.disabled = false;
    }
  });
  setTimeout(() => input.focus(), 320);
}

// ---------------------------------------------------------------- Overlays

function overlay(cls) {
  const o = document.createElement('div');
  o.className = 'overlay ' + cls;
  document.body.append(o);
  requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('show')));
  return o;
}

/** Schließt per Escape/Tippen daneben; gibt eine Schließen-Funktion zurück. */
function trapOverlay(o, onDismiss) {
  const prevFocus = document.activeElement;
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
  document.addEventListener('keydown', onKey);
  o.addEventListener('click', (e) => { if (e.target === o) onDismiss(); });
  return () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    o.classList.remove('show');
    setTimeout(() => o.remove(), 400);
    if (prevFocus && prevFocus.focus && prevFocus !== document.body) prevFocus.focus({ preventScroll: true });
  };
}

function actionSheet({ title, message, actions }) {
  return new Promise((resolve) => {
    const o = overlay('sheet-overlay');
    const sheet = document.createElement('div');
    sheet.className = 'asheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const group = document.createElement('div');
    group.className = 'asheet-group';
    if (title || message) {
      const h = document.createElement('div');
      h.className = 'asheet-header';
      if (title) { const p = document.createElement('p'); p.className = 'asheet-title'; p.textContent = title; h.append(p); }
      if (message) { const p = document.createElement('p'); p.className = 'asheet-message'; p.textContent = message; h.append(p); }
      group.append(h);
    }
    let finish;
    const close = trapOverlay(o, () => finish(null));
    finish = (v) => { close(); resolve(v); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'asheet-btn' + (a.destructive ? ' destructive' : '');
      b.textContent = a.label;
      if (a.checked) { b.insertAdjacentHTML('beforeend', ICON.mark); b.setAttribute('aria-current', 'true'); }
      b.addEventListener('click', () => finish(a.value));
      group.append(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'asheet-btn asheet-cancel';
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', () => finish(null));
    sheet.append(group, cancel);
    o.append(sheet);
    setTimeout(() => (group.querySelector('.asheet-btn') || cancel).focus({ preventScroll: true }), 60);
  });
}

function showAlert(title, message, buttons = [{ label: 'OK', value: true, bold: true }]) {
  return new Promise((resolve) => {
    const o = overlay('alert-overlay');
    const box = document.createElement('div');
    box.className = 'alert';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const body = document.createElement('div');
    body.className = 'alert-body';
    const t = document.createElement('p'); t.className = 'alert-title'; t.textContent = title;
    body.append(t);
    if (message) { const m = document.createElement('p'); m.className = 'alert-message'; m.textContent = message; body.append(m); }
    const row = document.createElement('div');
    row.className = 'alert-buttons' + (buttons.length > 2 ? ' stacked' : '');
    let finish;
    const cancelValue = buttons[0].value; // Escape = erster Knopf (Abbrechen bzw. OK)
    const close = trapOverlay(o, () => {});
    const onEsc = (e) => { if (e.key === 'Escape') finish(cancelValue); };
    document.addEventListener('keydown', onEsc);
    finish = (v) => { document.removeEventListener('keydown', onEsc); close(); resolve(v); };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.bold) btn.classList.add('bold');
      if (b.destructive) btn.classList.add('destructive');
      btn.addEventListener('click', () => finish(b.value));
      row.append(btn);
    }
    box.append(body, row);
    o.append(box);
    setTimeout(() => row.querySelector('button').focus({ preventScroll: true }), 60);
  });
}

let hudTimer = null;
function hud(text) {
  els.hud.querySelector('.hud-text').textContent = text;
  els.hud.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => els.hud.classList.remove('show'), 1300);
}

// ---------------------------------------------------------------- Start

(async function start() {
  applyAdmin();
  updateComposer();
  if (state.token) {
    try { await api('GET', 'admin/check'); } catch (err) { if (err.status === 401) dropAdmin(); }
  }
  await refresh();
  schedulePoll();
  if (location.pathname.replace(/\/+$/, '').endsWith('/admin') && !isAdmin()) openLogin();
})();
