// ─────────────────────────────────────────────────────────────────────────────
// ANU Student Sign-In System — v2.0 Firebase Edition
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY  = 'anu_signins';   // fallback localStorage key
const MAX_RECORDS  = 100;             // Firestore fetches up to this many
const COLLECTION   = 'signins';       // Firestore collection name

// ─── Firebase State ───────────────────────────────────────────────────────────
let db            = null;
let auth          = null;
let firebaseReady = false;

function initFirebase() {
  try {
    if (typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey.includes('PASTE_YOUR')) {
      setFirebaseStatus('not-configured');
      showFirebaseNotConfiguredNote();
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    db   = firebase.firestore();
    auth = firebase.auth();
    firebaseReady = true;
    setFirebaseStatus('connected');

    // Watch auth state
    auth.onAuthStateChanged(user => {
      if (user) {
        showAdminDashboard(user.email);
        loadFirestoreRecords();
      } else {
        showAdminLoginPanel();
      }
    });

    updateSummary();
  } catch (e) {
    console.error('Firebase init error:', e);
    setFirebaseStatus('error');
  }
}

function setFirebaseStatus(state) {
  const dot  = document.getElementById('fb-dot');
  const text = document.getElementById('fb-status-text');
  if (!dot || !text) return;

  const states = {
    'connected':      { color: '#16A34A', label: 'Firebase connected — records saving to cloud' },
    'not-configured': { color: '#F59E0B', label: 'Firebase not configured — using browser storage' },
    'error':          { color: '#DC2626', label: 'Firebase error — using browser storage' },
  };

  const s = states[state] || states['error'];
  dot.style.background  = s.color;
  text.textContent      = s.label;
  text.style.color      = s.color;
}

function showFirebaseNotConfiguredNote() {
  const note = document.getElementById('firebase-not-configured-note');
  if (note) note.style.display = 'block';
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }

function generateToken() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase().slice(0, 10);
}

function avatarSVG(name) {
  const initials = (name || 'ST').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" rx="8" fill="#003366"/>
    <text x="40" y="52" text-anchor="middle" font-size="28" font-family="sans-serif" font-weight="700" fill="#C8971A">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// ─── Storage: Firestore + localStorage fallback ────────────────────────────────
async function saveRecord(token, record) {
  // Always save to localStorage as backup
  try {
    const data = loadLocalRecords();
    data[token] = record;
    const entries = Object.entries(data);
    if (entries.length > MAX_RECORDS) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_RECORDS))));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {}

  // Also save to Firestore if available
  if (firebaseReady && db) {
    try {
      await db.collection(COLLECTION).doc(token).set(record);
    } catch (e) {
      console.error('Firestore save error:', e);
    }
  }
}

function loadLocalRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

async function loadRecords() {
  if (firebaseReady && db) {
    try {
      const snap    = await db.collection(COLLECTION).orderBy('timestamp', 'desc').limit(MAX_RECORDS).get();
      const records = {};
      snap.forEach(doc => { records[doc.id] = doc.data(); });
      return records;
    } catch (e) {
      console.error('Firestore load error:', e);
    }
  }
  return loadLocalRecords();
}

async function deleteAllRecords() {
  // Clear localStorage
  try { localStorage.removeItem(STORAGE_KEY); } catch {}

  // Clear Firestore
  if (firebaseReady && db) {
    try {
      const snap  = await db.collection(COLLECTION).get();
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.error('Firestore delete error:', e);
    }
  }
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────
function findTodaySignIn(studentId) {
  const today = new Date().toDateString();
  return Object.values(loadLocalRecords()).find(r => r.id === studentId && r.date === today) || null;
}

// ─── Barcode ──────────────────────────────────────────────────────────────────
function renderBarcode(value) {
  const wrap       = $('#student-barcode');
  const tokenEl    = $('#barcode-token');
  const actions    = $('#barcode-actions');
  const printBtn   = $('#print-barcode-btn');
  const downloadBtn= $('#download-barcode-btn');

  if (!wrap) return;
  wrap.innerHTML = '';
  if (tokenEl) tokenEl.textContent = '';
  if (actions) actions.style.display = 'none';

  if (typeof JsBarcode === 'undefined') { console.error('JsBarcode not loaded'); return; }

  try {
    const pxW = Math.round((50 * 96) / 25.4);
    const pxH = Math.round((15 * 96) / 25.4);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', pxW + 'px');
    svg.setAttribute('height', pxH + 'px');
    svg.setAttribute('aria-label', 'Student barcode');
    svg.style.cssText = 'width:50mm;height:15mm;';
    wrap.appendChild(svg);

    JsBarcode(svg, value, { format: 'CODE128', lineColor: '#000', width: 1, height: pxH - 8, displayValue: true, fontSize: 11, margin: 0 });

    if (tokenEl) tokenEl.textContent = `Token: ${value}`;
    if (actions) actions.style.display = 'flex';
    if (printBtn)    printBtn.onclick    = () => printBarcode(svg);
    if (downloadBtn) downloadBtn.onclick = () => downloadBarcode(svg, value);
  } catch (e) { console.error('Barcode error:', e); }
}

function printBarcode(svg) {
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups to print.'); return; }
  w.document.write(`<!doctype html><html><head><title>Barcode</title></head>
    <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
    ${svg.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function downloadBarcode(svg, value) {
  const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
  const a   = Object.assign(document.createElement('a'), { href: url, download: `barcode-${value}.svg` });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Photo ────────────────────────────────────────────────────────────────────
function updatePhoto(student) {
  const img  = $('#student-photo');
  const info = $('#student-photo-info');
  if (!img || !info) return;

  if (!student) {
    img.src = avatarSVG('ST');
    img.alt = 'Student placeholder';
    info.innerHTML = '<p>No student selected yet.</p>';
    return;
  }
  img.src = student.photo || avatarSVG(student.name);
  img.alt = `Photo of ${student.name}`;
  info.innerHTML = `<p><strong>${student.name}</strong><br/><small style="color:#9CA3AF">${student.id}</small></p>`;
}

// ─── Admin Table ──────────────────────────────────────────────────────────────
async function loadFirestoreRecords() {
  const tbody    = document.querySelector('#admin-records-table tbody');
  const noteEl   = $('#admin-source-note');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9CA3AF;padding:1.5rem">Loading…</td></tr>';

  const records = await loadRecords();
  renderTable(tbody, records);

  if (noteEl) {
    const count  = Object.keys(records).length;
    const source = firebaseReady ? 'Firebase Firestore' : 'browser localStorage';
    noteEl.textContent = `Showing ${count} record${count !== 1 ? 's' : ''} from ${source}.`;
  }
}

function renderTable(tbody, records) {
  if (!tbody) return;
  tbody.innerHTML = '';
  const entries = Object.entries(records || {});

  if (!entries.length) {
    const tr = tbody.insertRow();
    const td = tr.insertCell();
    td.colSpan = 7;
    td.textContent = 'No records yet.';
    td.style.cssText = 'text-align:center;color:#9CA3AF;padding:2rem;font-style:italic;';
    return;
  }

  entries.forEach(([token, r], i) => {
    const tr = tbody.insertRow();
    [i + 1, token, r.id || '', r.name || '', r.laptop || '—', r.time || '', r.date || '']
      .forEach(v => { const td = tr.insertCell(); td.textContent = v; });
  });
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
async function exportCSV() {
  const records = await loadRecords();
  const entries = Object.entries(records);
  if (!entries.length) { alert('No records to export.'); return; }

  const rows = [
    ['#', 'Token', 'Student ID', 'Name', 'Laptop', 'Time', 'Date'],
    ...entries.map(([token, r], i) =>
      [i + 1, token, r.id || '', r.name || '', r.laptop || '', r.time || '', r.date || ''])
  ];
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const date = new Date().toISOString().slice(0, 10);
  const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a    = Object.assign(document.createElement('a'), { href: url, download: `ANU_SignIns_${date}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Clear Records ────────────────────────────────────────────────────────────
async function clearRecords() {
  if (!confirm('Delete ALL sign-in records? This cannot be undone.')) return;
  await deleteAllRecords();
  const tbody = document.querySelector('#admin-records-table tbody');
  renderTable(tbody, {});
  updateSummary();
  const noteEl = $('#admin-source-note');
  if (noteEl) noteEl.textContent = '0 records.';
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────
function showAdminDashboard(email) {
  const loginPanel  = $('#admin-login-panel');
  const dashboard   = $('#admin-dashboard');
  const emailBadge  = $('#admin-email-display');
  if (loginPanel)  loginPanel.style.display  = 'none';
  if (dashboard)   dashboard.style.display   = '';
  if (emailBadge)  emailBadge.textContent     = email;
}

function showAdminLoginPanel() {
  const loginPanel  = $('#admin-login-panel');
  const dashboard   = $('#admin-dashboard');
  if (loginPanel)  loginPanel.style.display  = '';
  if (dashboard)   dashboard.style.display   = 'none';
}

async function adminLogin() {
  const email    = $('#admin-email')?.value.trim();
  const password = $('#admin-password')?.value;
  const errorEl  = $('#login-error');
  const btn      = $('#admin-login-btn');

  if (!email || !password) {
    if (errorEl) { errorEl.textContent = 'Please enter your email and password.'; errorEl.className = 'status error'; }
    return;
  }

  if (!firebaseReady || !auth) {
    if (errorEl) { errorEl.textContent = 'Firebase is not configured yet. Please set up firebase-config.js first.'; errorEl.className = 'status error'; }
    return;
  }

  if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
  if (errorEl) { errorEl.textContent = ''; errorEl.className = 'status'; }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will handle showing dashboard
  } catch (e) {
    const messages = {
      'auth/user-not-found':  'No admin account found with this email.',
      'auth/wrong-password':  'Incorrect password. Try again.',
      'auth/invalid-email':   'Please enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please wait a moment.',
    };
    const msg = messages[e.code] || 'Login failed. Check your credentials.';
    if (errorEl) { errorEl.textContent = msg; errorEl.className = 'status error'; }
  } finally {
    if (btn) { btn.textContent = 'Sign In to Admin'; btn.disabled = false; }
  }
}

async function adminLogout() {
  if (auth) await auth.signOut();
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function updateSummary() {
  const records    = loadLocalRecords();
  const entries    = Object.entries(records);
  const today      = new Date().toDateString();
  const todayCount = entries.filter(([, r]) => r.date === today).length;

  const countEl = $('#summary-count');
  const lastEl  = $('#summary-last');
  const heroEl  = $('#hero-count');

  if (countEl) countEl.textContent = entries.length;
  if (heroEl)  heroEl.textContent  = todayCount;
  if (lastEl) {
    if (!entries.length) { lastEl.textContent = 'None'; return; }
    const last = entries[entries.length - 1][1];
    lastEl.textContent = last.time ? `${last.name} at ${last.time}` : last.name || 'Unknown';
  }
}

// ─── Sign-In Handler ──────────────────────────────────────────────────────────
async function handleSignIn(e) {
  e.preventDefault();

  const id     = $('#student-id')?.value.trim();
  const name   = $('#student-name')?.value.trim();
  const laptop = $('#laptop-make')?.value.trim() || '';
  const status = $('#signin-status');
  const form   = $('#signin-form');
  const btn    = form?.querySelector('button[type="submit"]');

  if (!id || !name) {
    if (status) { status.textContent = 'Please enter your Student ID and Full Name.'; status.className = 'status error'; }
    return;
  }

  // Duplicate check
  const dup = findTodaySignIn(id);
  if (dup) {
    const go = confirm(`⚠️ ${name} (${id}) already signed in today at ${dup.time}.\n\nSign in again anyway?`);
    if (!go) return;
  }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const now   = new Date();
  const time  = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date  = now.toDateString();
  const token = generateToken();

  const record = {
    id:        id,
    name:      name,
    laptop:    laptop,
    time:      time,
    date:      date,
    timestamp: firebaseReady ? firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
  };

  await saveRecord(token, record);

  const saved = firebaseReady ? '✓ Signed in & saved to cloud' : '✓ Signed in (saved locally)';
  if (status) { status.textContent = `${saved} — ${name} at ${time}`; status.className = 'status success'; }

  renderBarcode(token);
  updatePhoto({ id, name, photo: null });
  updateSummary();
  if (form) form.reset();
  if (btn) { btn.textContent = 'Sign In & Generate Barcode'; btn.disabled = false; }
}

// ─── Demo Students ────────────────────────────────────────────────────────────
const DEMO = [
  { id: 'S1001', name: 'Alice Mwangi',  laptop: 'Dell Inspiron'   },
  { id: 'S1002', name: 'James Otieno',  laptop: 'HP Pavilion'     },
  { id: 'S1003', name: 'Grace Njeri',   laptop: 'Lenovo ThinkPad' },
];

function populateDemoSelect() {
  const sel = $('#demo-select');
  if (!sel) return;
  DEMO.forEach(s => sel.add(new Option(`${s.id} — ${s.name}`, s.id)));
}

function fillDemo() {
  const sel = $('#demo-select');
  const s   = DEMO.find(d => d.id === sel?.value);
  if (!s) return;
  if ($('#student-id'))   $('#student-id').value   = s.id;
  if ($('#student-name')) $('#student-name').value = s.name;
  if ($('#laptop-make'))  $('#laptop-make').value  = s.laptop;
  updatePhoto(s);
}

// ─── Observers & Nav ──────────────────────────────────────────────────────────
function initObserver() {
  const obs = new IntersectionObserver(
    es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
    { threshold: 0.1 }
  );
  document.querySelectorAll('.section').forEach(s => obs.observe(s));
}

function initNavHighlight() {
  const links = document.querySelectorAll('.nav-links a');
  const obs   = new IntersectionObserver(
    es => es.forEach(e => {
      if (e.isIntersecting)
        links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
    }),
    { threshold: 0.4 }
  );
  document.querySelectorAll('section[id]').forEach(s => obs.observe(s));
}

function initMobileNav() {
  const toggle = $('#nav-toggle');
  const links  = $('#nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => links.classList.toggle('open'));
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
}

function initSmoothScroll() {
  document.querySelectorAll('.nav-links a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const t = document.getElementById(a.getAttribute('href').slice(1));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
}

function prefillFromURL() {
  const id = new URLSearchParams(location.search).get('id');
  if (id) { const el = $('#student-id'); if (el) el.value = id; }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initObserver();
  initNavHighlight();
  initMobileNav();
  initSmoothScroll();
  prefillFromURL();
  populateDemoSelect();
  updatePhoto(null);
  updateSummary();

  // Sign-in form
  $('#signin-form')?.addEventListener('submit', handleSignIn);

  // Demo fill
  $('#fill-demo-btn')?.addEventListener('click', fillDemo);

  // Admin login
  $('#admin-login-btn')?.addEventListener('click', adminLogin);
  $('#admin-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });

  // Admin logout
  $('#admin-logout-btn')?.addEventListener('click', adminLogout);

  // Admin table actions
  $('#refresh-records-btn')?.addEventListener('click', loadFirestoreRecords);
  $('#export-csv-btn')?.addEventListener('click', exportCSV);
  $('#clear-records-btn')?.addEventListener('click', clearRecords);
});