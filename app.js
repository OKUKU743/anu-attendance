/* ═══════════════════════════════════════════════════
   ANU Attendance System v3.0 — app.js
   Features:
   - Barcode + QR code generation
   - Firebase Firestore cloud storage
   - Admin login with search, date filter, print sheet
   - Attendance statistics dashboard
   - Student lookup by token or ID
   - Dark mode toggle
   - Duplicate detection
   - Welcome back message for returning students
   ═══════════════════════════════════════════════════ */

'use strict';

/* ─── Demo Students ───────────────────────────────── */
const DEMO_STUDENTS = [
  { id: 'S1001', name: 'Alice Mwangi',  laptop: 'Dell Inspiron' },
  { id: 'S1002', name: 'James Otieno',  laptop: 'HP EliteBook'  },
  { id: 'S1003', name: 'Grace Njeri',   laptop: ''              },
];

/* ─── State ───────────────────────────────────────── */
let allRecords    = [];   // full unfiltered records
let filteredRecs  = [];   // after search/date filter
let db            = null;
let auth          = null;
let fbReady       = false;

/* ─── Token Generator ─────────────────────────────── */
function generateToken() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
    .toUpperCase()
    .slice(0, 10);
}

/* ─── Avatar SVG ──────────────────────────────────── */
function makeAvatar(name) {
  const initials = name
    .split(' ')
    .map(w => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const colors = ['#003366', '#004080', '#005599', '#C8971A', '#16A34A'];
  const bg = colors[name.charCodeAt(0) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" rx="8" fill="${bg}"/>
    <text x="40" y="52" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="700" fill="#FFFFFF">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

/* ─── localStorage Helpers ────────────────────────── */
const LS_KEY = 'anu_signins';

function lsGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function lsSave(records) {
  localStorage.setItem(LS_KEY, JSON.stringify(records.slice(-50)));
}

function lsAdd(record) {
  const records = lsGet();
  records.push(record);
  lsSave(records);
}

/* ─── Firebase Init ───────────────────────────────── */
function initFirebase() {
  try {
    if (typeof firebaseConfig === 'undefined') {
      throw new Error('firebase-config.js not loaded');
    }
    const cfg = firebaseConfig;
    if (!cfg.apiKey || cfg.apiKey.includes('PASTE_YOUR')) {
      throw new Error('Firebase keys not configured');
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db   = firebase.firestore();
    auth = firebase.auth();
    fbReady = true;
    setFbStatus('green', 'Firebase connected — records saving to cloud');

    auth.onAuthStateChanged(user => {
      if (user) showAdminDashboard(user);
      else      showAdminLogin();
    });
  } catch (err) {
    fbReady = false;
    const isNotConfigured = err.message.includes('not configured') || err.message.includes('not loaded');
    setFbStatus('amber', 'Firebase not configured — using browser storage');
    if (isNotConfigured) {
      const note = document.getElementById('firebase-not-configured-note');
      if (note) note.style.display = 'block';
    } else {
      setFbStatus('red', 'Firebase error — using browser storage');
    }
    console.warn('[ANU] Firebase init failed:', err.message);
  }
}

function setFbStatus(color, text) {
  const dot  = document.getElementById('fb-dot');
  const span = document.getElementById('fb-status-text');
  if (!dot || !span) return;
  const map = { green: '#16A34A', amber: '#D97706', red: '#DC2626' };
  dot.style.background = map[color] || '#9CA3AF';
  span.textContent = text;
}

/* ─── Save Record ─────────────────────────────────── */
async function saveRecord(record) {
  lsAdd(record);
  if (fbReady && db) {
    try {
      await db.collection('signins').add(record);
    } catch (err) {
      console.warn('[ANU] Firestore write error:', err.message);
    }
  }
}

/* ─── Load All Records ────────────────────────────── */
async function loadRecords() {
  if (fbReady && db) {
    try {
      const snap = await db.collection('signins')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
      allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return;
    } catch (err) {
      console.warn('[ANU] Firestore read error:', err.message);
    }
  }
  allRecords = lsGet().reverse();
}

/* ─── Sign-In Form ────────────────────────────────── */
function setupSignInForm() {
  const form   = document.getElementById('signin-form');
  const status = document.getElementById('signin-status');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const sid    = document.getElementById('student-id').value.trim();
    const sname  = document.getElementById('student-name').value.trim();
    const laptop = document.getElementById('laptop-make').value.trim();

    if (!sid || !sname) {
      showStatus(status, 'error', 'Please fill in Student ID and Full Name.');
      return;
    }

    // Duplicate check
    const today = new Date().toLocaleDateString('en-KE');
    const existing = lsGet().find(r => r.studentId === sid && r.date === today);
    if (existing) {
      const go = confirm(`${sname} already signed in today at ${existing.time}.\nSign in again anyway?`);
      if (!go) return;
    }

    // Check if returning student
    const allLs = lsGet();
    const returning = allLs.some(r => r.studentId === sid);
    if (returning) {
      showWelcomeBack(sname);
    }

    const token = generateToken();
    const now   = new Date();
    const record = {
      token,
      studentId: sid,
      name:      sname,
      laptop:    laptop || '—',
      time:      now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
      date:      today,
      timestamp: Date.now(),
    };

    await saveRecord(record);

    // Generate codes
    generateBarcode(token);
    generateQRCode(token);

    // Show avatar
    document.getElementById('student-photo').src = makeAvatar(sname);
    document.getElementById('student-photo-info').innerHTML =
      `<p><strong>${sname}</strong><br/>ID: ${sid}${laptop ? `<br/>Laptop: ${laptop}` : ''}</p>`;

    // Update counters
    updateCounters();

    showStatus(status, 'success', fbReady
      ? `\u2713 Signed in & saved to cloud — Token: ${token}`
      : `\u2713 Signed in (saved locally) — Token: ${token}`
    );

    document.getElementById('barcode-actions').style.display = 'flex';
    form.reset();
    updateStats();
  });
}

/* ─── Barcode ─────────────────────────────────────── */
function generateBarcode(token) {
  const wrap = document.getElementById('student-barcode');
  wrap.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'barcode-svg';
  wrap.appendChild(svg);
  try {
    JsBarcode('#barcode-svg', token, {
      format:      'CODE128',
      lineColor:   '#001f3f',
      width:       2,
      height:      60,
      displayValue: false,
    });
    document.getElementById('barcode-token').textContent = 'Token: ' + token;
    document.getElementById('qrcode-token').textContent  = 'Token: ' + token;
  } catch (err) {
    wrap.innerHTML = '<p style="color:red;font-size:0.8rem">Barcode error</p>';
  }
}

/* ─── QR Code with Center Logo ────────────────────── */
function generateQRCode(token) {
  const wrap = document.getElementById('student-qrcode');
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  try {
    QRCode.toCanvas(canvas, token, {
      width:            200,
      margin:           2,
      errorCorrectionLevel: 'H',
      color: { dark: '#001f3f', light: '#FFFFFF' }
    }, function(err) {
      if (err) {
        wrap.innerHTML = '<p style="color:red;font-size:0.8rem">QR error</p>';
        return;
      }
      // Draw ANU logo in center
      const ctx    = canvas.getContext('2d');
      const size   = canvas.width;
      const logo   = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = 'https://upload.wikimedia.org/wikipedia/en/5/54/Africa_Nazarene_University_Logo.png';
      logo.onload = function() {
        const logoSize = size * 0.22;
        const logoX    = (size - logoSize) / 2;
        const logoY    = (size - logoSize) / 2;
        // White background circle behind logo
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        // Draw logo
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      };
      logo.onerror = function() {
        // Fallback: draw ANU text in center if image fails
        const logoSize = size * 0.22;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.fillStyle = '#001f3f';
        ctx.font = `bold ${size * 0.07}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ANU', size / 2, size / 2);
      };
    });
  } catch (err) {
    wrap.innerHTML = '<p style="color:red;font-size:0.8rem">QR error</p>';
  }
}

/* ─── Code Tabs ───────────────────────────────────── */
function setupCodeTabs() {
  document.querySelectorAll('.code-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('barcode-panel').style.display = target === 'barcode' ? '' : 'none';
      document.getElementById('qrcode-panel').style.display  = target === 'qrcode'  ? '' : 'none';
    });
  });
}

/* ─── Download / Print ────────────────────────────── */
function setupBarcodeActions() {
  document.getElementById('print-barcode-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('download-barcode-btn').addEventListener('click', () => {
    const active = document.querySelector('.code-tab.active').dataset.tab;
    if (active === 'barcode') {
      const svg = document.getElementById('barcode-svg');
      if (!svg) return;
      const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'barcode.svg';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const canvas = document.querySelector('#student-qrcode canvas');
      if (!canvas) return;
      const a    = document.createElement('a');
      a.href     = canvas.toDataURL('image/png');
      a.download = 'qrcode.png';
      a.click();
    }
  });
}

/* ─── Demo Students ───────────────────────────────── */
function setupDemo() {
  const sel = document.getElementById('demo-select');
  DEMO_STUDENTS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(s);
    opt.textContent = `${s.name} (${s.id})`;
    sel.appendChild(opt);
  });
  document.getElementById('fill-demo-btn').addEventListener('click', () => {
    if (!sel.value) return;
    const s = JSON.parse(sel.value);
    document.getElementById('student-id').value   = s.id;
    document.getElementById('student-name').value  = s.name;
    document.getElementById('laptop-make').value   = s.laptop;
  });
}

/* ─── Welcome Banner ──────────────────────────────── */
function showWelcomeBack(name) {
  const banner = document.getElementById('welcome-banner');
  banner.textContent = `Welcome back, ${name}! `;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 4000);
}

/* ─── Status Helper ───────────────────────────────── */
function showStatus(el, type, msg) {
  el.className = 'status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ─── Update Counters ─────────────────────────────── */
function updateCounters() {
  const today    = new Date().toLocaleDateString('en-KE');
  const records  = lsGet();
  const todayRecs = records.filter(r => r.date === today);
  document.getElementById('hero-count').textContent    = todayRecs.length;
  document.getElementById('summary-count').textContent = records.length;
  const last = records[records.length - 1];
  document.getElementById('summary-last').textContent  = last ? last.name : 'None';
}

/* ─── Statistics ──────────────────────────────────── */
async function updateStats() {
  await loadRecords();
  const records = allRecords;
  const today   = new Date().toLocaleDateString('en-KE');

  document.getElementById('stat-total').textContent = records.length;
  document.getElementById('stat-today').textContent = records.filter(r => r.date === today).length;

  const uniqueIds = new Set(records.map(r => r.studentId));
  document.getElementById('stat-unique').textContent = uniqueIds.size;

  // Peak hour
  const hourCounts = {};
  records.forEach(r => {
    const h = r.time ? r.time.split(':')[0] : null;
    if (h) hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  const peakH = Object.keys(hourCounts).sort((a, b) => hourCounts[b] - hourCounts[a])[0];
  document.getElementById('stat-peak').textContent = peakH ? `${peakH}:00` : '—';

  // Top students
  const studentCounts = {};
  const studentNames  = {};
  records.forEach(r => {
    studentCounts[r.studentId] = (studentCounts[r.studentId] || 0) + 1;
    studentNames[r.studentId]  = r.name;
  });
  const top = Object.keys(studentCounts)
    .sort((a, b) => studentCounts[b] - studentCounts[a])
    .slice(0, 5);

  const maxCount = top.length ? studentCounts[top[0]] : 1;
  const list = document.getElementById('top-students-list');
  if (!top.length) {
    list.innerHTML = '<p style="color:var(--grey-400);font-size:0.88rem">No records yet.</p>';
    return;
  }
  list.innerHTML = top.map((id, i) => `
    <div class="top-student-row">
      <span class="top-rank">${i + 1}</span>
      <span class="top-name">${studentNames[id]}</span>
      <span class="top-id">${id}</span>
      <div class="top-bar-wrap">
        <div class="top-bar" style="width:${Math.round(studentCounts[id] / maxCount * 100)}%"></div>
      </div>
      <span class="top-count">${studentCounts[id]}</span>
    </div>
  `).join('');
}

/* ─── Student Lookup ──────────────────────────────── */
function setupLookup() {
  document.getElementById('lookup-btn').addEventListener('click', doLookup);
  document.getElementById('lookup-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLookup();
  });
}

async function doLookup() {
  const query  = document.getElementById('lookup-input').value.trim().toUpperCase();
  const result = document.getElementById('lookup-result');
  if (!query) return;

  await loadRecords();
  const match = allRecords.find(r =>
    (r.token     && r.token.toUpperCase()     === query) ||
    (r.studentId && r.studentId.toUpperCase() === query)
  );

  if (!match) {
    result.innerHTML = `<p class="lookup-empty">No record found for "${query}".</p>`;
    return;
  }

  result.innerHTML = `
    <div class="lookup-card">
      <div class="lookup-card-row"><strong>Name</strong><br/>${match.name}</div>
      <div class="lookup-card-row"><strong>Student ID</strong><br/>${match.studentId}</div>
      <div class="lookup-card-row"><strong>Token</strong><br/>${match.token}</div>
      <div class="lookup-card-row"><strong>Laptop</strong><br/>${match.laptop || '—'}</div>
      <div class="lookup-card-row"><strong>Date</strong><br/>${match.date}</div>
      <div class="lookup-card-row"><strong>Time</strong><br/>${match.time}</div>
    </div>
  `;
}

/* ─── Admin ───────────────────────────────────────── */
function setupAdmin() {
  document.getElementById('admin-login-btn').addEventListener('click', adminLogin);
  document.getElementById('admin-logout-btn').addEventListener('click', adminLogout);
  document.getElementById('refresh-records-btn').addEventListener('click', () => loadAdminRecords());
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('print-sheet-btn').addEventListener('click', printSheet);
  document.getElementById('clear-records-btn').addEventListener('click', clearAllRecords);

  // Search filter
  document.getElementById('admin-search').addEventListener('input', applyFilters);
  document.getElementById('admin-date-filter').addEventListener('change', applyFilters);
  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    document.getElementById('admin-search').value = '';
    document.getElementById('admin-date-filter').value = '';
    applyFilters();
  });
}

async function adminLogin() {
  if (!fbReady || !auth) {
    showStatus(document.getElementById('login-error'), 'error',
      'Firebase not configured. Cannot log in.');
    return;
  }
  const email    = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  const errEl    = document.getElementById('login-error');
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    showStatus(errEl, 'error', 'Login failed: ' + err.message);
  }
}

function adminLogout() {
  if (auth) auth.signOut();
}

function showAdminDashboard(user) {
  document.getElementById('admin-login-panel').style.display  = 'none';
  document.getElementById('admin-dashboard').style.display    = '';
  document.getElementById('admin-email-display').textContent  = user.email;
  loadAdminRecords();
}

function showAdminLogin() {
  document.getElementById('admin-login-panel').style.display = '';
  document.getElementById('admin-dashboard').style.display   = 'none';
}

async function loadAdminRecords() {
  document.getElementById('admin-source-note').textContent = 'Loading records…';
  await loadRecords();
  filteredRecs = [...allRecords];
  renderTable(filteredRecs);
  const src = fbReady ? 'Firebase Firestore' : 'browser storage';
  document.getElementById('admin-source-note').textContent =
    `${allRecords.length} records from ${src}.`;
}

function applyFilters() {
  const search = document.getElementById('admin-search').value.trim().toLowerCase();
  const date   = document.getElementById('admin-date-filter').value;

  filteredRecs = allRecords.filter(r => {
    const matchSearch = !search ||
      (r.name      && r.name.toLowerCase().includes(search)) ||
      (r.studentId && r.studentId.toLowerCase().includes(search)) ||
      (r.token     && r.token.toLowerCase().includes(search));

    let matchDate = true;
    if (date) {
      const filterDate = new Date(date).toLocaleDateString('en-KE');
      matchDate = r.date === filterDate;
    }

    return matchSearch && matchDate;
  });

  renderTable(filteredRecs);
  document.getElementById('admin-source-note').textContent =
    `Showing ${filteredRecs.length} of ${allRecords.length} records.`;
}

function renderTable(records) {
  const tbody = document.querySelector('#admin-records-table tbody');
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--grey-400);padding:1.5rem">No records found.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><code style="font-size:0.78rem">${r.token || '—'}</code></td>
      <td>${r.studentId || '—'}</td>
      <td>${r.name || '—'}</td>
      <td>${r.laptop || '—'}</td>
      <td>${r.time || '—'}</td>
      <td>${r.date || '—'}</td>
    </tr>
  `).join('');
}

/* ─── Export CSV ──────────────────────────────────── */
function exportCSV() {
  const rows = [['#', 'Token', 'Student ID', 'Name', 'Laptop', 'Time', 'Date']];
  const source = filteredRecs.length ? filteredRecs : allRecords;
  source.forEach((r, i) =>
    rows.push([i + 1, r.token, r.studentId, r.name, r.laptop, r.time, r.date])
  );
  const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ANU_SignIns_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Print Attendance Sheet ──────────────────────── */
function printSheet() {
  const source = filteredRecs.length ? filteredRecs : allRecords;
  const rows = source.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.studentId}</td>
      <td>${r.name}</td>
      <td>${r.laptop}</td>
      <td>${r.time}</td>
      <td>${r.date}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>ANU Attendance Sheet</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 2rem; font-size: 12px; }
        h1   { font-size: 1.4rem; margin-bottom: 0.25rem; }
        p    { font-size: 0.85rem; color: #666; margin-bottom: 1rem; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
        th { background: #001f3f; color: white; }
        tr:nth-child(even) { background: #f9fafb; }
      </style>
    </head>
    <body>
      <h1>Africa Nazarene University — Attendance Sheet</h1>
      <p>Generated: ${new Date().toLocaleString('en-KE')} &nbsp;|&nbsp; Total: ${source.length} records</p>
      <table>
        <thead><tr><th>#</th><th>Student ID</th><th>Name</th><th>Laptop</th><th>Time</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.print();
}

/* ─── Clear All Records ───────────────────────────── */
async function clearAllRecords() {
  if (!confirm('Delete ALL records permanently? This cannot be undone.')) return;
  localStorage.removeItem(LS_KEY);
  if (fbReady && db) {
    try {
      const snap = await db.collection('signins').limit(100).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (err) {
      console.warn('[ANU] Clear error:', err.message);
    }
  }
  allRecords   = [];
  filteredRecs = [];
  renderTable([]);
  updateCounters();
  updateStats();
  document.getElementById('admin-source-note').textContent = 'All records cleared.';
}

/* ─── Dark Mode ───────────────────────────────────── */
function setupDarkMode() {
  const btn  = document.getElementById('dark-toggle');
  const html = document.documentElement;
  const saved = localStorage.getItem('anu_theme');
  if (saved === 'dark') {
    html.setAttribute('data-theme', 'dark');
    btn.textContent = '☀️';
  }
  btn.addEventListener('click', () => {
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    btn.textContent = isDark ? '🌙' : '☀️';
    localStorage.setItem('anu_theme', isDark ? 'light' : 'dark');
  });
}

/* ─── Navbar ──────────────────────────────────────── */
function setupNavbar() {
  document.getElementById('nav-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });

  const sections = document.querySelectorAll('.section[id]');
  const links    = document.querySelectorAll('.nav-links a');

  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const active = document.querySelector(`.nav-links a[href="#${e.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => obs.observe(s));
}

/* ─── Scroll Animations ───────────────────────────── */
function setupScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('visible');
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.section').forEach(s => obs.observe(s));
}

/* ─── Boot ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  setupDarkMode();
  setupNavbar();
  setupScrollAnimations();
  setupSignInForm();
  setupCodeTabs();
  setupBarcodeActions();
  setupDemo();
  setupLookup();
  setupAdmin();
  updateCounters();
  updateStats();
});
