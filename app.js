'use strict';

/* ================================================================
   COURSE VERIFIER · app.js
   All-in-one frontend: MongoDB Atlas Data API + Client-side logic
   ================================================================ */

// ── Domain Ranges (fixed by course ID) ───────────────────────────
const DOMAIN_RANGES = [
    { label: 'Free',                   min: 1,    max: 25   },
    { label: 'Free to Audit',          min: 26,   max: 48   },
    { label: 'High Value Low Cost',    min: 49,   max: 100  },
    { label: 'Foundational',           min: 101,  max: 601  },
    { label: 'Network Infrastructure', min: 602,  max: 1585 },
    { label: 'System & Endpoint',      min: 1586, max: 1890 },
    { label: 'Cyber Forensics',        min: 1891, max: 2634 },
    { label: 'Data & Application',     min: 2635, max: 2965 },
    { label: 'Legal & Ethical',        min: 2966, max: 3727 },
];

function getDomainLabel(id) {
    const n = parseInt(id, 10);
    if (isNaN(n)) return 'Uncategorised';
    for (const r of DOMAIN_RANGES) {
        if (n >= r.min && n <= r.max) return r.label;
    }
    return 'Uncategorised';
}

// ── State ─────────────────────────────────────────────────────────
let allCourses = [];
let domainChart = null;
let statusChart = null;

let vfPage = 1;
let cfPage = 1;
const PAGE_SIZE = 100;

let vfFilter = { search: '', status: 'issues', country: 'all', domain: 'all' };
let cfFilter = { search: '', status: 'all', country: 'all', domain: 'all', qs: 'any' };

let modalCourse = null;

// ── DOM helpers ───────────────────────────────────────────────────
function byId(id) { return document.getElementById(id); }

function setText(id, val) {
    const el = byId(id);
    if (el) el.textContent = val;
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function badgeHtml(status) {
    const cls = {
        Verified:    'badge-verified',
        Discrepancy: 'badge-discrepancy',
        Error:       'badge-error',
    }[status] || 'badge-error';
    return `<span class="badge ${cls}">${escHtml(status || '—')}</span>`;
}

function rowIsMismatch(r) {
    if (r.status) return r.status.toUpperCase() !== 'MATCH';
    return r.original !== r.verified;
}

function countByStatus() {
    let verified = 0, disc = 0, err = 0;
    for (const c of allCourses) {
        if (c.status === 'Verified') verified++;
        else if (c.status === 'Discrepancy') disc++;
        else if (c.status === 'Error') err++;
    }
    return { verified, disc, err };
}

// ── API Fetchers (Vercel Serverless) ──────────────────────────────

async function fetchAllCourses() {
    setLoaderSub('Fetching courses from database…');
    const res = await fetch('/api/get_courses');
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const docs = data.documents || [];
    setLoaderSub(`Loaded ${docs.length} courses…`);
    return docs;
}

async function mongoUpdateCourse(courseId, update) {
    const res = await fetch('/api/solve_course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseId, update })
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
    }
    return res.json();
}

// ── Loader helpers ────────────────────────────────────────────────

function setLoaderSub(text) {
    const el = byId('loader-sub');
    if (el) el.textContent = text;
}

function setConnStatus(state) {
    const dot = byId('conn-dot');
    const label = byId('conn-label');
    if (!dot || !label) return;
    dot.className = 'status-dot ' + state;
    label.textContent = state === 'connected' ? 'Connected'
                      : state === 'error'     ? 'Error'
                      : 'Connecting';
}

// ── INIT ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initTabs();

    try {
        setConnStatus('connecting');
        allCourses = await fetchAllCourses();
        setConnStatus('connected');

        const loading = byId('loading-screen');
        const main = byId('main-page');
        if (loading) loading.style.display = 'none';
        if (main) main.style.display = 'block';

        populateFilters();
        renderDashboard();
        renderVerificationTab();
        renderCoursesTab();

        initFilters();
        initTableRowClicks();
        initModal();
        initKpiClickThrough();

    } catch (err) {
        setConnStatus('error');
        setLoaderSub('Connection failed: ' + err.message);
        console.error('[MongoFetch]', err);
    }
});

// ── THEME ─────────────────────────────────────────────────────────

function initTheme() {
    const saved = localStorage.getItem('cv_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);

    const btn = byId('theme-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('cv_theme', next);
        updateThemeIcon(next);
        renderDashboard();
    });
}

function updateThemeIcon(theme) {
    const el = byId('theme-icon');
    if (el) el.textContent = theme === 'dark' ? '☀' : '🌙';
}

// ── TABS ──────────────────────────────────────────────────────────

function initTabs() {
    const nav = byId('nav-tabs');
    if (!nav) return;
    nav.addEventListener('click', e => {
        const link = e.target.closest('.nav-tab');
        if (!link) return;
        e.preventDefault();
        const target = link.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        link.classList.add('active');
        const tab = byId(target);
        if (tab) tab.classList.add('active');
    });
}

// ── POPULATE FILTER DROPDOWNS ─────────────────────────────────────

function populateFilters() {
    const countries = [...new Set(allCourses.map(c => c.country).filter(Boolean))].sort();
    const domains = DOMAIN_RANGES.map(r => r.label);

    ['vf-country', 'cf-country'].forEach(id => {
        const sel = byId(id);
        if (!sel) return;
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            sel.appendChild(opt);
        });
    });

    ['vf-domain', 'cf-domain'].forEach(id => {
        const sel = byId(id);
        if (!sel) return;
        domains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            sel.appendChild(opt);
        });
    });
}

// ── FILTER EVENTS ─────────────────────────────────────────────────

function initFilters() {
    let vfTimer, cfTimer;

    const vfSearch = byId('vf-search');
    if (vfSearch) vfSearch.addEventListener('input', e => {
        clearTimeout(vfTimer);
        vfTimer = setTimeout(() => {
            vfFilter.search = e.target.value.toLowerCase();
            vfPage = 1;
            renderVerificationTab();
        }, 220);
    });

    const vfStatus = byId('vf-status');
    if (vfStatus) vfStatus.addEventListener('change', e => {
        vfFilter.status = e.target.value;
        vfPage = 1;
        renderVerificationTab();
    });

    const vfCountry = byId('vf-country');
    if (vfCountry) vfCountry.addEventListener('change', e => {
        vfFilter.country = e.target.value;
        vfPage = 1;
        renderVerificationTab();
    });

    const vfDomain = byId('vf-domain');
    if (vfDomain) vfDomain.addEventListener('change', e => {
        vfFilter.domain = e.target.value;
        vfPage = 1;
        renderVerificationTab();
    });

    const vfReset = byId('vf-reset');
    if (vfReset) vfReset.addEventListener('click', () => {
        vfFilter = { search: '', status: 'issues', country: 'all', domain: 'all' };
        if (vfSearch) vfSearch.value = '';
        if (vfStatus) vfStatus.value = 'issues';
        if (vfCountry) vfCountry.value = 'all';
        if (vfDomain) vfDomain.value = 'all';
        vfPage = 1;
        renderVerificationTab();
    });

    const cfSearch = byId('cf-search');
    if (cfSearch) cfSearch.addEventListener('input', e => {
        clearTimeout(cfTimer);
        cfTimer = setTimeout(() => {
            cfFilter.search = e.target.value.toLowerCase();
            cfPage = 1;
            renderCoursesTab();
        }, 220);
    });

    const cfStatus = byId('cf-status');
    if (cfStatus) cfStatus.addEventListener('change', e => {
        cfFilter.status = e.target.value;
        cfPage = 1;
        renderCoursesTab();
    });

    const cfCountry = byId('cf-country');
    if (cfCountry) cfCountry.addEventListener('change', e => {
        cfFilter.country = e.target.value;
        cfPage = 1;
        renderCoursesTab();
    });

    const cfDomain = byId('cf-domain');
    if (cfDomain) cfDomain.addEventListener('change', e => {
        cfFilter.domain = e.target.value;
        cfPage = 1;
        renderCoursesTab();
    });

    const cfQs = byId('cf-qs');
    if (cfQs) cfQs.addEventListener('change', e => {
        cfFilter.qs = e.target.value;
        cfPage = 1;
        renderCoursesTab();
    });

    const cfReset = byId('cf-reset');
    if (cfReset) cfReset.addEventListener('click', () => {
        cfFilter = { search: '', status: 'all', country: 'all', domain: 'all', qs: 'any' };
        if (cfSearch) cfSearch.value = '';
        if (cfStatus) cfStatus.value = 'all';
        if (cfCountry) cfCountry.value = 'all';
        if (cfDomain) cfDomain.value = 'all';
        if (cfQs) cfQs.value = 'any';
        cfPage = 1;
        renderCoursesTab();
    });

    const vfPrev = byId('vf-prev');
    if (vfPrev) vfPrev.addEventListener('click', () => {
        if (vfPage > 1) { vfPage--; renderVerificationTab(); }
    });

    const vfNext = byId('vf-next');
    if (vfNext) vfNext.addEventListener('click', () => {
        vfPage++;
        renderVerificationTab();
    });

    const cfPrev = byId('cf-prev');
    if (cfPrev) cfPrev.addEventListener('click', () => {
        if (cfPage > 1) { cfPage--; renderCoursesTab(); }
    });

    const cfNext = byId('cf-next');
    if (cfNext) cfNext.addEventListener('click', () => {
        cfPage++;
        renderCoursesTab();
    });
}

function initTableRowClicks() {
    ['vf-tbody', 'cf-tbody'].forEach(id => {
        const tbody = byId(id);
        if (!tbody) return;
        tbody.addEventListener('click', e => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            openModal(row.dataset.id);
        });
    });
}

// ── KPI click-through to Verification tab ────────────────────────
function initKpiClickThrough() {
    const discCard = byId('kpi-disc-card');
    if (discCard) discCard.addEventListener('click', () => {
        vfFilter.status = 'Discrepancy';
        vfPage = 1;
        const sel = byId('vf-status');
        if (sel) sel.value = 'Discrepancy';
        const tab = document.querySelector('.nav-tab[data-tab="tab-verification"]');
        if (tab) tab.click();
    });

    const errCard = byId('kpi-err-card');
    if (errCard) errCard.addEventListener('click', () => {
        vfFilter.status = 'Error';
        vfPage = 1;
        const sel = byId('vf-status');
        if (sel) sel.value = 'Error';
        const tab = document.querySelector('.nav-tab[data-tab="tab-verification"]');
        if (tab) tab.click();
    });

    const strip = byId('vf-strip');
    if (strip) strip.addEventListener('click', e => {
        const card = e.target.closest('.kpi-strip-card');
        if (!card) return;
        document.querySelectorAll('.kpi-strip-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const status = card.dataset.vfStatus;
        vfFilter.status = status;
        vfPage = 1;
        const sel = byId('vf-status');
        if (sel) sel.value = status;
        renderVerificationTab();
    });
}

// ── DASHBOARD ─────────────────────────────────────────────────────

function renderDashboard() {
    const { verified, disc, err } = countByStatus();
    const total = allCourses.length;
    const pct = total ? Math.round((verified / total) * 100) : 0;

    setText('kpi-total', total.toLocaleString());
    setText('kpi-verified', verified.toLocaleString());
    setText('kpi-verified-pct', `${pct}% of total`);
    setText('kpi-disc', disc.toLocaleString());
    setText('kpi-err', err.toLocaleString());

    renderDomainChart();
    renderStatusDonut(verified, disc, err);
    renderCountryList();
}

function renderDomainChart() {
    const canvas = byId('domainBarChart');
    if (!canvas) return;

    const counts = {};
    DOMAIN_RANGES.forEach(r => { counts[r.label] = 0; });
    allCourses.forEach(c => {
        const lbl = getDomainLabel(c.id);
        counts[lbl] = (counts[lbl] || 0) + 1;
    });

    const labels = Object.keys(counts);
    const data = Object.values(counts);
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#94a3b8' : '#64748b';
    const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const ctx = canvas.getContext('2d');
    if (domainChart) domainChart.destroy();

    domainChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: 'rgba(99,102,241,0.6)',
                borderColor: 'rgba(99,102,241,1)',
                borderWidth: 1,
                borderRadius: 6,
                hoverBackgroundColor: 'rgba(99,102,241,0.85)',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toLocaleString()} courses` } }
            },
            scales: {
                x: { ticks: { color: textCol, font: { size: 11 } }, grid: { color: gridCol } },
                y: { ticks: { color: textCol, font: { size: 11 } }, grid: { color: gridCol }, beginAtZero: true },
            },
        },
    });
}

function renderStatusDonut(verified, disc, err) {
    const canvas = byId('statusDonut');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (statusChart) statusChart.destroy();

    statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Verified', 'Discrepancy', 'Error'],
            datasets: [{
                data: [verified, disc, err],
                backgroundColor: ['rgba(34,197,94,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)'],
                borderColor: ['#22c55e', '#f59e0b', '#ef4444'],
                borderWidth: 2,
                hoverOffset: 8,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw.toLocaleString()}` } }
            },
        },
    });

    const legend = byId('donut-legend');
    if (!legend) return;

    const total = verified + disc + err;
    legend.innerHTML = [
        { label: 'Verified',    color: '#22c55e', val: verified },
        { label: 'Discrepancy', color: '#f59e0b', val: disc },
        { label: 'Error',       color: '#ef4444', val: err },
    ].map(i => `
        <div class="donut-legend-item">
            <div class="donut-dot" style="background:${i.color}"></div>
            ${i.label} — ${i.val.toLocaleString()} (${total ? Math.round((i.val / total) * 100) : 0}%)
        </div>
    `).join('');
}

function renderCountryList() {
    const list = byId('country-list');
    if (!list) return;

    const counts = {};
    allCourses.forEach(c => {
        if (c.country) counts[c.country] = (counts[c.country] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const max = sorted[0]?.[1] || 1;

    list.innerHTML = sorted.map(([name, count], i) => `
        <div class="country-row">
            <div class="country-rank">${i + 1}</div>
            <div class="country-name" title="${escHtml(name)}">${escHtml(name)}</div>
            <div class="country-bar-wrap">
                <div class="country-bar" style="width:${Math.round((count / max) * 100)}%"></div>
            </div>
            <div class="country-count">${count}</div>
        </div>
    `).join('');
}

// ── VERIFICATION TAB ──────────────────────────────────────────────

function applyVfFilter(courses) {
    const { search, status, country, domain } = vfFilter;
    return courses.filter(c => {
        if (status !== 'all') {
            if (status === 'issues' ? c.status === 'Verified' : c.status !== status) return false;
        }
        if (country !== 'all' && c.country !== country) return false;
        if (domain !== 'all' && getDomainLabel(c.id) !== domain) return false;
        if (search) {
            const hay = `${c.name} ${c.university} ${c.country} ${c.disc_reason}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });
}

function renderVerificationTab() {
    const filtered = applyVfFilter(allCourses);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (vfPage > totalPages) vfPage = totalPages;
    const slice = filtered.slice((vfPage - 1) * PAGE_SIZE, vfPage * PAGE_SIZE);

    const { verified, disc, err } = countByStatus();
    setText('vfs-total', total.toLocaleString());
    setText('vfs-disc', disc.toLocaleString());
    setText('vfs-err', err.toLocaleString());
    setText('vfs-ver', verified.toLocaleString());

    const tbody = byId('vf-tbody');
    if (!tbody) return;

    if (!slice.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No courses match the current filters.</td></tr>';
    } else {
        tbody.innerHTML = slice.map((c, i) => `
            <tr data-id="${c.id}" title="Click to view details">
                <td>${(vfPage - 1) * PAGE_SIZE + i + 1}</td>
                <td title="${escHtml(c.name)}" style="max-width:260px;">${escHtml(c.name)}</td>
                <td title="${escHtml(c.university)}">${escHtml(c.university || '—')}</td>
                <td>${escHtml(c.country || '—')}</td>
                <td><span style="font-size:0.78rem; color:var(--text-muted);">${getDomainLabel(c.id)}</span></td>
                <td>${badgeHtml(c.status)}</td>
                <td style="font-size:0.78rem; color:var(--text-muted); max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(c.disc_reason || c.issue_sub_type || '')}">${escHtml(c.disc_reason || c.issue_sub_type || '—')}</td>
            </tr>
        `).join('');
    }

    setText('vf-pag-info', `Page ${vfPage} of ${totalPages} (${total.toLocaleString()} courses)`);
    const prev = byId('vf-prev');
    const next = byId('vf-next');
    if (prev) prev.disabled = vfPage <= 1;
    if (next) next.disabled = vfPage >= totalPages;
}

// ── ALL COURSES TAB ───────────────────────────────────────────────

function applyCfFilter(courses) {
    const { search, status, country, domain, qs } = cfFilter;
    return courses.filter(c => {
        if (status !== 'all' && c.status !== status) return false;
        if (country !== 'all' && c.country !== country) return false;
        if (domain !== 'all' && getDomainLabel(c.id) !== domain) return false;
        if (qs === 'yes' && !c.has_qs_badge) return false;
        if (qs === 'no' && c.has_qs_badge) return false;
        if (search) {
            const hay = `${c.name} ${c.university} ${c.country} ${c.skills || ''}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });
}

function renderCoursesTab() {
    const filtered = applyCfFilter(allCourses);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (cfPage > totalPages) cfPage = totalPages;
    const slice = filtered.slice((cfPage - 1) * PAGE_SIZE, cfPage * PAGE_SIZE);

    const tbody = byId('cf-tbody');
    if (!tbody) return;

    if (!slice.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No courses match the current filters.</td></tr>';
    } else {
        tbody.innerHTML = slice.map((c, i) => `
            <tr data-id="${c.id}" title="Click to view details">
                <td>${(cfPage - 1) * PAGE_SIZE + i + 1}</td>
                <td title="${escHtml(c.name)}">${escHtml(c.name)}</td>
                <td title="${escHtml(c.university)}">${escHtml(c.university || '—')}</td>
                <td>${escHtml(c.country || '—')}</td>
                <td><span style="font-size:0.78rem; color:var(--text-muted);">${getDomainLabel(c.id)}</span></td>
                <td>${c.has_qs_badge ? '<span class="badge" style="background:var(--blue-bg);color:var(--blue);border:1px solid rgba(59,130,246,0.25);">QS ✓</span>' : '—'}</td>
                <td>${badgeHtml(c.status)}</td>
            </tr>
        `).join('');
    }

    setText('cf-pag-info', `Page ${cfPage} of ${totalPages} (${total.toLocaleString()} courses)`);
    const prev = byId('cf-prev');
    const next = byId('cf-next');
    if (prev) prev.disabled = cfPage <= 1;
    if (next) next.disabled = cfPage >= totalPages;
}

// ── MODAL ─────────────────────────────────────────────────────────

function initModal() {
    const closeBtn = byId('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const modal = byId('course-modal');
    if (modal) modal.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });

    const solveAllBtn = byId('modal-solve-all');
    if (solveAllBtn) solveAllBtn.addEventListener('click', solveAll);

    const tbody = byId('modal-tbody');
    if (tbody) tbody.addEventListener('click', e => {
        const btn = e.target.closest('.btn-solve');
        if (!btn) return;
        solveAttr(modalCourse.id, btn.dataset.attr, btn.dataset.solved === 'true');
    });
}

async function openModal(courseId) {
    const cBase = allCourses.find(x => x.id == courseId);
    if (!cBase) return;

    setText('modal-title', cBase.name || '—');
    setText('modal-sub', 'Fetching details from database...');
    const meta = byId('modal-meta');
    const tbody = byId('modal-tbody');
    if (meta) meta.innerHTML = '';
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading comparison data...</td></tr>';
    const modal = byId('course-modal');
    if (modal) modal.classList.add('open');

    try {
        const res = await fetch(`/api/get_course_details?id=${courseId}`);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`API error ${res.status}: ${err}`);
        }
        const data = await res.json();
        const c = data.document;
        if (!c) throw new Error('Course not found');
        modalCourse = c;

        setText('modal-sub', `${c.university || '—'}  ·  ${c.country || '—'}  ·  Page ${c.pdf_page || '?'}`);

        const badge = byId('modal-badge');
        if (badge) {
            badge.className = 'badge badge-' + (c.status || '').toLowerCase();
            badge.textContent = c.status || '—';
        }

        if (meta) {
            meta.innerHTML = [
                ['Cost',     c.cost],
                ['Duration', c.duration],
                ['Mode',     c.mode],
                ['Domain',   getDomainLabel(c.id)],
                ['QS',       c.has_qs_badge ? '✓ Ranked' : '—'],
                ['NIRF',     c.has_nirf_badge ? '✓ Ranked' : '—'],
            ].map(([k, v]) => `<div class="meta-chip"><strong>${k}:</strong> ${escHtml(String(v || '—'))}</div>`).join('');
        }

        const rows = c.pdf_table || [];
        const solved = c.solved_attrs || [];
        const hasMismatch = rows.some(rowIsMismatch);

        if (!tbody) return;

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No comparison data available.</td></tr>';
        } else {
            tbody.innerHTML = rows.map(r => {
                const isSolved = solved.includes(r.attribute?.toLowerCase());
                const isMismatch = rowIsMismatch(r);
                const rowClass = isSolved ? 'solved-row' : isMismatch ? 'mismatch-row' : '';
                const matchIcon = isMismatch
                    ? '<span class="match-icon match-no">✕</span>'
                    : '<span class="match-icon match-yes">✓</span>';
                const btn = isMismatch
                    ? `<button class="btn-solve ${isSolved ? 'solved' : ''}"
                           data-attr="${escHtml(r.attribute)}"
                           data-solved="${isSolved}"
                           title="${isSolved ? 'Undo resolve' : 'Mark as resolved'}">
                           ${isSolved ? '✓ Solved' : 'Solve'}
                       </button>`
                    : '<span style="color:var(--text-dim); font-size:0.78rem;">OK</span>';
                return `<tr class="${rowClass}">
                    <td>${escHtml(r.attribute || '—')}</td>
                    <td>${escHtml(r.original  || '—')}</td>
                    <td>${escHtml(r.verified  || '—')}</td>
                    <td>${matchIcon}</td>
                    <td>${btn}</td>
                </tr>`;
            }).join('');
        }

        const allSolved = rows.every(r => !rowIsMismatch(r) || solved.includes(r.attribute?.toLowerCase()));
        const hint = byId('modal-hint');
        if (hint) hint.textContent = c.disc_reason || '';

        const solveAllBtn = byId('modal-solve-all');
        if (solveAllBtn) {
            solveAllBtn.style.display = (hasMismatch && c.status !== 'Verified') ? 'inline-flex' : 'none';
            solveAllBtn.textContent = allSolved ? '✓ All Resolved' : '✓ Mark All Resolved';
        }

    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color:var(--red)">Error loading details: ${err.message}</td></tr>`;
    }
}

function closeModal() {
    const modal = byId('course-modal');
    if (modal) modal.classList.remove('open');
    modalCourse = null;
}

// ── SOLVE ─────────────────────────────────────────────────────────

async function solveAttr(courseId, attr, isSolved) {
    const c = allCourses.find(x => x.id == courseId);
    if (!c) return;

    const prev = {
        solved_attrs: [...(c.solved_attrs || [])],
        status: c.status,
        issue_category: c.issue_category
    };

    let solved = [...prev.solved_attrs];
    const key = attr.toLowerCase();

    if (isSolved) {
        solved = solved.filter(s => s !== key);
    } else if (!solved.includes(key)) {
        solved.push(key);
    }

    const rows = c.pdf_table || [];
    const mismatchAttrs = rows.filter(rowIsMismatch).map(r => r.attribute?.toLowerCase());
    const allSolved = mismatchAttrs.every(a => solved.includes(a));

    const update = {
        solved_attrs: solved,
        status: allSolved ? 'Verified' : c.status,
        issue_category: allSolved ? 'verified' : c.issue_category,
    };

    Object.assign(c, update);

    try {
        await mongoUpdateCourse(courseId, update);
        openModal(courseId);
        renderVerificationTab();
        renderCoursesTab();
        renderDashboard();
    } catch (err) {
        Object.assign(c, prev);
        alert('Failed to save: ' + err.message);
    }
}

async function solveAll() {
    if (!modalCourse) return;

    const local = allCourses.find(x => x.id == modalCourse.id);
    const localPrev = local ? {
        solved_attrs: [...(local.solved_attrs || [])],
        status: local.status,
        issue_category: local.issue_category
    } : null;

    const modalPrev = {
        solved_attrs: [...(modalCourse.solved_attrs || [])],
        status: modalCourse.status,
        issue_category: modalCourse.issue_category
    };

    const rows = modalCourse.pdf_table || [];
    const solved = rows.map(r => r.attribute?.toLowerCase()).filter(Boolean);

    const update = {
        solved_attrs: solved,
        status: 'Verified',
        issue_category: 'verified',
    };

    if (local) Object.assign(local, update);
    Object.assign(modalCourse, update);

    try {
        await mongoUpdateCourse(modalCourse.id, update);
        openModal(modalCourse.id);
        renderVerificationTab();
        renderCoursesTab();
        renderDashboard();
    } catch (err) {
        if (local && localPrev) Object.assign(local, localPrev);
        Object.assign(modalCourse, modalPrev);
        alert('Failed to save: ' + err.message);
    }
}