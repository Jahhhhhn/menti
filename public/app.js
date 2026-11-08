/* Menti – Oberfläche. Daten in der Firebase Realtime Database (Änderungen kommen live),
   Besucher sind anonym angemeldet, Ersteller melden sich mit Google an (Freischaltung unter /ersteller). */

import { initializeApp } from './vendor/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut, GoogleAuthProvider,
} from './vendor/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, push, update, remove, serverTimestamp,
} from './vendor/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const MAX_LEN = 300;
const COOLDOWN_MS = 5000; // muss zu database.rules.json passen

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);

const ICON = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3c-.3 0-.6-.1-.8-.3C6 15.6 2.8 12.6 2.8 8.9 2.8 6 5 3.8 7.8 3.8c1.7 0 3.2.8 4.2 2.2 1-1.4 2.5-2.2 4.2-2.2 2.8 0 5 2.2 5 5.1 0 3.7-3.2 6.7-8.4 11.1-.2.2-.5.3-.8.3z"/></svg>',
  check: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle class="ring" cx="13" cy="13" r="11"/><path class="tick" d="m8.2 13.4 3.2 3.2 6.4-6.8"/></svg>',
  tick: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mark: '<svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 4 4 8-8.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bubble: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M28 9C16.4 9 7 16.8 7 26.4c0 5.5 3.1 10.4 7.9 13.6-.4 2.6-1.7 5.2-3.6 7.2 4.1-.2 8-1.8 10.6-4 2 .5 4 .8 6.1.8 11.6 0 21-7.8 21-17.4S39.6 9 28 9z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M24.3 22.2a3.9 3.9 0 1 1 5.6 3.5c-1.2.6-1.9 1.4-1.9 2.6v.7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="28" cy="33.4" r="1.8" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M13 16h30M23 16v-3.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V16M16.5 16l2 27a3 3 0 0 0 3 2.8h13a3 3 0 0 0 3-2.8l2-27M24 23v15M32 23v15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  done: '<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="20" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="m19.5 28.6 6 6 11.5-12.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#list'), empty: $('#empty'), emptyIcon: $('#emptyIcon'), emptyTitle: $('#emptyTitle'), emptyText: $('#emptyText'),
  loading: $('#loading'), sectionHeader: $('#sectionHeader'), segmented: $('#segmented'),
  countOpen: $('#countOpen'), countDone: $('#countDone'), countDeleted: $('#countDeleted'), segDeleted: $('#segDeleted'), sortBtn: $('#sortBtn'), adminBtn: $('#adminBtn'), inboxBtn: $('#inboxBtn'), inboxBadge: $('#inboxBadge'),
  adminBanner: $('#adminBanner'), offline: $('#offline'), largeTitle: $('#largeTitle'),
  composer: $('#composer'), input: $('#input'), send: $('#send'), counter: $('#counter'),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* privat */ } },
};

const state = {
  user: null,          // Firebase-Nutzer (anonym oder Google)
  admin: false,
  raw: {},             // /fragen
  myLikes: {},         // /likes/{uid}
  own: new Set(readOwn()), // eigene Fragen (nur in diesem Browser gemerkt)
  questions: [],
  loaded: false,
  tab: 'open',
  sort: store.get('menti.sort') === 'new' ? 'new' : 'top',
  sending: false,
  lastSent: 0,
  requests: [],        // offene Anfragen für den Erstellerzugang (nur für Ersteller)
  blocked: [],         // gesperrte Konten (nur für Ersteller)
  trash: {},           // /papierkorb – von Erstellern gelöschte Fragen (nur für Ersteller)
};

function readOwn() {
  try { const a = JSON.parse(store.get('menti.eigene') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

function rememberOwn(id) {
  state.own.add(id);
  store.set('menti.eigene', JSON.stringify([...state.own].slice(-200)));
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (id) => state.questions.find((q) => q.id === id);
const isAdmin = () => state.admin;
const isGoogle = () => !!state.user && !state.user.isAnonymous;
const codeOf = (err) => String((err && (err.code || err.message)) || 'unbekannt');
const denied = (err) => /permission[_ -]denied/i.test(String(err && (err.code || err.message)));

function errorText(err) {
  if (denied(err)) return 'Keine Berechtigung.';
  if (!navigator.onLine) return 'Keine Internetverbindung.';
  return 'Unbekannter Fehler. Bitte versuch es noch einmal.';
}

// ---------------------------------------------------------------- Daten (live)

function rebuild() {
  state.questions = Object.entries(state.raw)
    .filter(([, v]) => v && typeof v.text === 'string')
    .map(([id, v]) => ({
      id,
      text: v.text,
      created: v.erstellt || 0,
      answered: !!v.beantwortet,
      answeredAt: v.beantwortetAm || v.erstellt || 0,
      likes: Math.max(0, v.likes || 0),
      liked: !!state.myLikes[id],
      own: state.own.has(id),
    }));
}

function liveUpdate() {
  rebuild();
  render({ animate: state.loaded });
  state.loaded = true;
}

onValue(ref(db, 'fragen'), (snap) => {
  state.raw = snap.val() || {};
  liveUpdate();
}, () => {
  els.loading.hidden = true;
  els.offline.hidden = false;
});

// Verbindungsanzeige (verzögert, damit sie beim Laden nicht aufblitzt)
let offlineTimer = null;
onValue(ref(db, '.info/connected'), (snap) => {
  clearTimeout(offlineTimer);
  if (snap.val()) els.offline.hidden = true;
  else offlineTimer = setTimeout(() => { els.offline.hidden = false; }, 2500);
});

let unsubLikes = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubLikes) { unsubLikes(); unsubLikes = null; }
  state.myLikes = {};
  state.user = user;
  state.admin = false;
  applyAdmin();
  if (state.loaded) liveUpdate();
  if (!user) {
    signInAnonymously(auth).catch((err) => {
      showAlert('Verbindung fehlgeschlagen', `Liken und Fragen sind gerade nicht möglich. Bitte lade die Seite neu. (${codeOf(err)})`);
    });
    return;
  }
  unsubLikes = onValue(ref(db, 'likes/' + user.uid), (snap) => {
    state.myLikes = snap.val() || {};
    if (state.loaded) liveUpdate();
  }, () => {});
  if (!user.isAnonymous) {
    state.admin = (await checkAdmin(user)) === true;
    if (state.user !== user) return;
    applyAdmin();
    refreshTimes();
  }
});

/** true/false = Ergebnis; null = Prüfung fehlgeschlagen. Direkt nach der Anmeldung hat die Datenbank-
    Verbindung evtl. noch das alte (anonyme) Token – dann wird abgelehnt, also kurz warten und erneut fragen. */
async function checkAdmin(user) {
  for (let i = 0; i < 6; i++) {
    try {
      await user.getIdToken();
      return (await get(ref(db, 'ersteller/' + user.uid))).exists();
    } catch {
      if (auth.currentUser !== user) return false;
      await sleep(300 * (i + 1));
    }
  }
  return null;
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
  if (state.tab === 'deleted') return trashItems();
  return state.questions.filter((q) => q.answered).sort((a, b) => b.answeredAt - a.answeredAt);
}

function trashItems() {
  return Object.entries(state.trash)
    .filter(([, v]) => v && typeof v.text === 'string')
    .map(([id, v]) => ({
      id, text: v.text, created: v.erstellt || 0, answered: !!v.beantwortet, answeredAt: v.beantwortetAm || 0,
      likes: v.likes || 0, liked: false, own: false, deleted: true, deletedAt: v.geloeschtAm || 0,
    }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

function render({ animate = false } = {}) {
  const openCount = state.questions.filter((q) => !q.answered).length;
  const doneCount = state.questions.length - openCount;
  els.countOpen.textContent = openCount || '';
  els.countDone.textContent = doneCount || '';
  els.countDeleted.textContent = Object.keys(state.trash).length || '';
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
    els.emptyText.textContent = doneCount ? 'Alle Fragen sind beantwortet. Stell gern eine neue!' : 'Stell die erste Frage.';
  } else if (state.tab === 'deleted') {
    els.sectionHeader.textContent = n ? `${n} gelöscht · zuletzt gelöscht zuerst` : '';
    els.emptyIcon.innerHTML = ICON.trash;
    els.emptyTitle.textContent = 'Nichts gelöscht';
    els.emptyText.textContent = 'Fragen, die ein Ersteller löscht, erscheinen hier und lassen sich wiederherstellen.';
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
  return el;
}

function updateCell(el, q) {
  el.querySelector('.q-text').textContent = q.text;
  el.classList.toggle('deleted', !!q.deleted);
  if (q.deleted) {
    const meta = el.querySelector('.q-meta');
    const t = document.createElement('span');
    t.textContent = 'gelöscht ' + relTime(q.deletedAt);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'q-del q-restore';
    back.textContent = 'Wiederherstellen';
    back.addEventListener('click', (e) => { e.stopPropagation(); restoreQuestion(q.id); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'q-del';
    del.textContent = 'Endgültig löschen';
    del.addEventListener('click', (e) => { e.stopPropagation(); purgeQuestion(q.id); });
    meta.replaceChildren(t, back, del);
    el.classList.remove('answered');
    return;
  }

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
  if (q.own || isAdmin()) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'q-del';
    del.textContent = 'Löschen';
    del.setAttribute('aria-label', 'Frage löschen');
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteQuestion(q.id); });
    meta.append(del);
  }

  const like = el.querySelector('.like');
  like.classList.toggle('liked', q.liked);
  like.setAttribute('aria-pressed', String(q.liked));
  like.setAttribute('aria-label', `${q.liked ? 'Like entfernen' : 'Liken'} (${q.likes} ${q.likes === 1 ? 'Like' : 'Likes'})`);
  el.querySelector('.like-count').textContent = q.likes;

  const check = el.querySelector('.check');
  check.setAttribute('aria-label', q.answered ? 'Wieder als offen markieren' : 'Als beantwortet markieren');
  el.classList.toggle('answered', q.answered);
}

function refreshTimes() {
  if (state.tab === 'deleted') { render(); return; }
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
  els.segmented.dataset.index = String(['open', 'answered', 'deleted'].indexOf(tab));
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
  if (!state.user) { showAlert('Nicht geliked', 'Verbindung wird noch aufgebaut. Bitte versuch es gleich noch einmal.'); return; }
  const want = !q.liked;
  const el = nodes.get(id);
  if (el && want) { const b = el.querySelector('.like'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  if (want && navigator.vibrate) navigator.vibrate(8);
  const uid = state.user.uid;
  // Like-Eintrag und Zähler ändern sich gemeinsam; die Regeln prüfen, dass beides zusammenpasst.
  // Hat gleichzeitig jemand anderes geliked, passt der Zähler nicht – dann frisch lesen und erneut versuchen.
  let count = (state.raw[id] && state.raw[id].likes) || 0;
  for (let attempt = 0; ; attempt++) {
    try {
      await update(ref(db), {
        [`likes/${uid}/${id}`]: want ? true : null,
        [`fragen/${id}/likes`]: count + (want ? 1 : -1),
      });
      return;
    } catch (err) {
      if (!denied(err) || attempt >= 3) { showAlert('Like nicht gespeichert', errorText(err)); return; }
      try {
        const [c, mine] = await Promise.all([get(ref(db, `fragen/${id}/likes`)), get(ref(db, `likes/${uid}/${id}`))]);
        if (!c.exists()) return; // Frage wurde gelöscht
        if (mine.exists() === want) return; // schon erledigt (z. B. in anderem Tab)
        count = c.val();
      } catch (e2) { showAlert('Like nicht gespeichert', errorText(e2)); return; }
    }
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

// Zum Vergleich auf doppelte Fragen zählen nur Buchstaben und Ziffern.
const normalize = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function clearComposer() {
  els.input.value = '';
  autosize();
  els.input.blur();
}

els.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.input.value.trim().replace(/\n{3,}/g, '\n\n');
  if (!text || state.sending || [...text].length > MAX_LEN) return;

  const dup = state.questions.find((q) => !q.answered && normalize(q.text) === normalize(text));
  if (dup) {
    clearComposer();
    await showAlert('Schon gefragt', 'Diese Frage gibt es schon – like sie einfach.');
    setTab('open');
    highlight(dup.id);
    return;
  }
  const wait = state.lastSent + COOLDOWN_MS - Date.now();
  if (wait > 0) {
    showAlert('Kurz warten', `Du kannst in ${Math.ceil(wait / 1000)} Sekunden die nächste Frage stellen.`);
    return;
  }
  if (!state.user) {
    showAlert('Nicht gesendet', 'Verbindung wird noch aufgebaut. Bitte versuch es gleich noch einmal.');
    return;
  }

  state.sending = true;
  updateComposer();
  const id = push(ref(db, 'fragen')).key;
  rememberOwn(id);
  try {
    const p = update(ref(db), {
      [`fragen/${id}`]: { text, erstellt: serverTimestamp(), beantwortet: false, likes: 0 },
      [`autoren/${id}`]: state.user.uid, // nicht lesbar – nur damit die Regeln eigenes Löschen erlauben
      [`zuletzt/${state.user.uid}`]: serverTimestamp(),
    });
    // Die Frage erscheint sofort (lokal), der Server bestätigt im Hintergrund.
    clearComposer();
    setTab('open');
    highlight(id);
    await p;
    state.lastSent = Date.now();
  } catch (err) {
    els.input.value = text;
    autosize();
    showAlert('Nicht gesendet', denied(err) ? 'Bitte warte ein paar Sekunden zwischen zwei Fragen.' : errorText(err));
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
  els.adminBtn.textContent = isGoogle() ? 'Abmelden' : 'Erstellerzugang';
  els.inboxBtn.hidden = !isAdmin();
  els.segDeleted.hidden = !isAdmin();
  els.segmented.classList.toggle('three', isAdmin());
  if (!isAdmin() && state.tab === 'deleted') setTab('open');
  refreshTimes(); // Löschen-Knöpfe ein-/ausblenden
  watchRequests();
}

// ---------------------------------------------------------------- Postfach (Anfragen, Gesperrt)

let unsubAdminLists = [];
let renderInbox = null; // gesetzt, solange das Postfach offen ist

/** /anfragen bzw. /gesperrt → sortierte Liste */
function toList(val) {
  return Object.entries(val || {})
    .filter(([, v]) => v && typeof v.email === 'string')
    .map(([uid, v]) => ({ uid, email: v.email, name: v.name || '', time: v.zeit || 0 }))
    .sort((a, b) => b.time - a.time);
}

function watchRequests() {
  if (isAdmin() && !unsubAdminLists.length) {
    unsubAdminLists = [
      onValue(ref(db, 'anfragen'), (snap) => { state.requests = toList(snap.val()); updateBadge(); },
        () => { state.requests = []; updateBadge(); }),
      onValue(ref(db, 'gesperrt'), (snap) => { state.blocked = toList(snap.val()); updateBadge(); },
        () => { state.blocked = []; updateBadge(); }),
      onValue(ref(db, 'papierkorb'), (snap) => { state.trash = snap.val() || {}; render({ animate: state.tab === 'deleted' }); },
        () => { state.trash = {}; render(); }),
    ];
  } else if (!isAdmin() && unsubAdminLists.length) {
    for (const u of unsubAdminLists) u();
    unsubAdminLists = [];
    state.requests = [];
    state.blocked = [];
    state.trash = {};
    updateBadge();
    render();
  }
}

function updateBadge() {
  const n = state.requests.length;
  els.inboxBadge.hidden = n === 0;
  els.inboxBadge.textContent = n > 99 ? '99+' : String(n);
  els.inboxBtn.setAttribute('aria-label', n ? `Anfragen (${n} offen)` : 'Anfragen');
  if (renderInbox) renderInbox();
}

els.inboxBtn.addEventListener('click', openInbox);

function pill(label, cls, aria, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill ' + cls;
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', () => onClick(b));
  return b;
}

function personRow(r, timeLabel, buttons) {
  const row = document.createElement('div');
  row.className = 'req';
  const main = document.createElement('div');
  main.className = 'req-main';
  const name = document.createElement('p');
  name.className = 'req-name';
  name.textContent = r.name || r.email;
  const mail = document.createElement('p');
  mail.className = 'req-mail';
  mail.textContent = (r.name ? r.email + ' · ' : '') + timeLabel;
  main.append(name, mail);
  const actions = document.createElement('div');
  actions.className = 'req-actions';
  actions.append(...buttons);
  row.append(main, actions);
  return row;
}

function openInbox() {
  let tab = 'requests';
  const o = overlay('form-overlay');
  o.innerHTML = `
    <div class="form-sheet" role="dialog" aria-modal="true" aria-labelledby="inboxTitle">
      <div class="grabber" aria-hidden="true"></div>
      <div class="sheet-bar">
        <span></span>
        <span class="sheet-title" id="inboxTitle">Postfach</span>
        <button class="nav-btn" type="button" data-done>Fertig</button>
      </div>
      <div class="segmented sheet-seg" role="tablist" data-index="0">
        <span class="seg-thumb" aria-hidden="true"></span>
        <button type="button" role="tab" aria-selected="true" data-tab="requests">Anfragen<span class="seg-count"></span></button>
        <button type="button" role="tab" aria-selected="false" data-tab="blocked">Gesperrt<span class="seg-count"></span></button>
      </div>
      <div class="req-list" aria-live="polite"></div>
      <p class="req-empty" hidden></p>
      <p class="form-footer"></p>
    </div>`;
  const seg = o.querySelector('.segmented');
  const counts = seg.querySelectorAll('.seg-count');
  const list = o.querySelector('.req-list');
  const empty = o.querySelector('.req-empty');
  const footer = o.querySelector('.form-footer');
  const close = trapOverlay(o, () => done());
  const done = () => { renderInbox = null; close(); };
  o.querySelector('[data-done]').addEventListener('click', done);
  for (const b of seg.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      seg.dataset.index = tab === 'requests' ? '0' : '1';
      for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
      renderInbox();
    });
  }

  renderInbox = () => {
    counts[0].textContent = state.requests.length || '';
    counts[1].textContent = state.blocked.length || '';
    if (tab === 'requests') {
      list.replaceChildren(...state.requests.map((r) => personRow(r, relTime(r.time), [
        pill('Ablehnen', 'reject', `${r.email} ablehnen`, (b) => rejectRequest(r, b)),
        pill('Sperren', 'reject', `${r.email} sperren`, (b) => blockRequest(r, b)),
        pill('Annehmen', 'accept', `${r.email} annehmen`, (b) => acceptRequest(r, b)),
      ])));
      empty.textContent = 'Keine offenen Anfragen.';
      empty.hidden = state.requests.length > 0;
      footer.textContent = 'Wer sich über „Erstellerzugang“ mit Google anmeldet, landet hier. Angenommene Konten '
        + 'können Fragen beantworten und löschen – und selbst Anfragen annehmen. Gesperrte können nicht mehr anfragen.';
    } else {
      list.replaceChildren(...state.blocked.map((r) => personRow(r, 'gesperrt ' + relTime(r.time), [
        pill('Entsperren', '', `${r.email} entsperren`, (b) => unblock(r, b)),
      ])));
      empty.textContent = 'Keine gesperrten Konten.';
      empty.hidden = state.blocked.length > 0;
      footer.textContent = 'Gesperrte Konten können keine Anfragen mehr stellen. Nach dem Entsperren geht es wieder.';
    }
  };
  renderInbox();
  setTimeout(() => o.querySelector('[data-done]').focus({ preventScroll: true }), 60);
}

async function adminWrite(changes, errTitle, button) {
  if (button) button.disabled = true;
  try {
    await update(ref(db), changes);
  } catch (err) {
    if (button) button.disabled = false;
    adminError(err, errTitle);
  }
}

function acceptRequest(r, button) {
  adminWrite({ [`ersteller/${r.uid}`]: r.email, [`anfragen/${r.uid}`]: null }, 'Nicht freigeschaltet', button);
}

function rejectRequest(r, button) {
  adminWrite({ [`anfragen/${r.uid}`]: null }, 'Nicht abgelehnt', button);
}

function blockRequest(r, button) {
  const entry = { email: r.email, zeit: serverTimestamp() };
  if (r.name) entry.name = r.name;
  adminWrite({ [`gesperrt/${r.uid}`]: entry, [`anfragen/${r.uid}`]: null }, 'Nicht gesperrt', button);
}

function unblock(r, button) {
  adminWrite({ [`gesperrt/${r.uid}`]: null }, 'Nicht entsperrt', button);
}

async function logout() {
  try { await signOut(auth); } catch { /* egal */ }
  // danach meldet onAuthStateChanged wieder anonym an
}

async function adminError(err, title) {
  if (denied(err) && state.user) {
    state.admin = (await checkAdmin(state.user)) === true;
    applyAdmin();
    showAlert(title, state.admin
      ? 'Firebase hat das abgelehnt. Sind die aktuellen Regeln aus database.rules.json in Firebase veröffentlicht?'
      : 'Dein Konto ist nicht (mehr) als Ersteller freigeschaltet.');
  } else {
    showAlert(title, errorText(err));
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
  await leaveAnimation(id);
  try {
    const p = update(ref(db, 'fragen/' + id), { beantwortet: answered, beantwortetAm: answered ? serverTimestamp() : null });
    await p;
  } catch (err) {
    adminError(err, 'Nicht gespeichert');
  }
}

async function deleteQuestion(id) {
  await leaveAnimation(id);
  try {
    const v = state.raw[id];
    if (isAdmin() && v) {
      // In den Papierkorb; autoren/{id} bleibt, damit der Fragende nach dem Wiederherstellen weiter löschen kann.
      await update(ref(db), { [`fragen/${id}`]: null, [`papierkorb/${id}`]: { ...v, geloeschtAm: serverTimestamp() } });
    } else {
      await update(ref(db), { [`fragen/${id}`]: null, [`autoren/${id}`]: null });
    }
  } catch (err) {
    if (isAdmin()) adminError(err, 'Nicht gelöscht');
    else showAlert('Nicht gelöscht', denied(err) ? 'Diese Frage kannst du nicht löschen.' : errorText(err));
  }
}

async function restoreQuestion(id) {
  const v = state.trash[id];
  if (!v) return;
  const { geloeschtAm, ...q } = v;
  await leaveAnimation(id);
  try {
    await update(ref(db), { [`fragen/${id}`]: q, [`papierkorb/${id}`]: null });
  } catch (err) {
    adminError(err, 'Nicht wiederhergestellt');
  }
}

async function purgeQuestion(id) {
  await leaveAnimation(id);
  try {
    await update(ref(db), { [`papierkorb/${id}`]: null, [`autoren/${id}`]: null });
  } catch (err) {
    adminError(err, 'Nicht gelöscht');
  }
}

els.adminBtn.addEventListener('click', () => (isGoogle() ? logout() : login()));

async function login() {
  let user;
  try {
    user = (await signInWithPopup(auth, new GoogleAuthProvider())).user;
  } catch (err) {
    const code = String(err && err.code);
    if (code.includes('popup-closed') || code.includes('cancelled-popup')) return;
    showAlert('Anmeldung fehlgeschlagen', code.includes('popup-blocked')
      ? 'Der Browser hat das Anmeldefenster blockiert. Bitte Pop-ups für diese Seite erlauben.'
      : code.includes('unauthorized-domain')
        ? 'Diese Adresse ist in Firebase nicht als Domain erlaubt.'
        : code.includes('operation-not-allowed')
          ? 'Die Google-Anmeldung ist in Firebase noch nicht eingeschaltet.'
          : `${errorText(err)} (${code})`);
    return;
  }
  const ok = await checkAdmin(user);
  if (ok) {
    return; // onAuthStateChanged schaltet den Ersteller-Modus ein
  }
  if (ok === null) {
    await signOut(auth).catch(() => {});
    showAlert('Prüfung fehlgeschlagen', 'Ob dein Konto freigeschaltet ist, ließ sich gerade nicht prüfen. Bitte versuch es noch einmal.');
    return;
  }
  // Nicht freigeschaltet: Anfrage ins Postfach der Ersteller legen und wieder abmelden (Besucher bleiben anonym).
  let sent = true;
  try {
    const req = { email: user.email || '', zeit: serverTimestamp() };
    if (user.displayName) req.name = user.displayName.slice(0, 100);
    await set(ref(db, 'anfragen/' + user.uid), req);
  } catch {
    sent = false;
  }
  let blocked = false;
  if (!sent) {
    try { blocked = (await get(ref(db, 'gesperrt/' + user.uid))).exists(); } catch { /* unbekannt */ }
  }
  await signOut(auth).catch(() => {});
  if (blocked) {
    showAlert('Keine Anfrage möglich', 'Dieses Konto kann keine Anfragen für den Erstellerzugang stellen.');
  } else if (sent) {
    showAlert('Anfrage gesendet', `Ein Ersteller kann ${user.email || 'dein Konto'} jetzt freischalten. Melde dich danach einfach noch einmal an.`);
  } else {
    showAlert('Anfrage nicht gesendet', 'Bitte versuch es noch einmal.');
  }
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


// ---------------------------------------------------------------- Start

applyAdmin();
updateComposer();
