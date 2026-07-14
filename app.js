/* ================================================================
   COURSE VERIFIER · app.js
   All-in-one frontend: MongoDB Atlas Data API + Client-side logic
   ================================================================ */

'use strict';

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

/**
 * Map a numeric course ID to its fixed domain label.
 * @param {string|number} id - Course identifier.
 * @returns {string} Domain label, or 'Uncategorised'.
 */
function getDomainLabel(id) {
    const n = parseInt(id, 10);
    if (isNaN(n)) return 'Uncategorised';
    for (const r of DOMAIN_RANGES) {
        if (n >= r.min && n <= r.max) return r.label;
    }
    return 'Uncategorised';
}

// ── State ─────────────────────────────────────────────────────────
let allCourses = [];           // All documents from MongoDB (loaded once)
let domainChart = null;
let statusChart = null;

let vfPage = 1;                // Verification tab pagination
let cfPage = 1;                // All Courses tab pagination
const PAGE_SIZE = 100;

let vfFilter = { search: '', status: 'issues', country: 'all', domain: 'all' };
let cfFilter = { search: '', status: 'all', country: 'all', domain: 'all', qs: 'any' };

let modalCourse = null;        // Currently open course in modal

// ── API Fetchers (Vercel Serverless) ──────────────────────────────

/**
 * Fetch ALL courses from the Vercel API.
 * @returns {Promise<Array>} Full sorted array of course documents.
 */
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

/**
 * Write an updated course back to MongoDB via Vercel API.
 * @param {string|number} courseId
 * @param {Object} update
 * @returns {Promise<Object>}
 */
async function mongoUpdateCourse(courseId, update) {
    const res = await fetch('/api/solve_course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseId, update: update })
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
    }
    return res.json();
}

// ── Loader helpers ────────────────────────────────────────────────

function setLoaderSub(text) {
    const el = document.getElementById('loader-sub');
    if (el) el.textContent = text;
}

function setConnStatus(state) {
    const dot   = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
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

        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('main-page').style.display      = 'block';

        populateFilters();
        initFilters();
        initTableClicks();
        initModal();

        renderDashboard();
        renderVerificationTab();
        renderCoursesTab();

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

    document.getElementById('theme-btn').addEventListener('click', () => {
        const cur  = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('cv_theme', next);
        updateThemeIcon(next);
        renderDashboard();
    });
}

function updateThemeIcon(theme) {
    const el = document.getElementById('theme-icon');
    if (el) el.textContent = theme === 'dark' ? '☀' : '🌙';
}

// ── TABS ──────────────────────────────────────────────────────────

function initTabs() {
    document.getElementById('nav-tabs').addEventListener('click', e => {
        const link = e.target.closest('.nav-tab');
        if (!link) return;
        e.preventDefault();
        const target = link.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        link.classList.add('active');
        document.getElementById(target).classList.add('active');
    });
}

// ── POPULATE FILTER DROPDOWNS ─────────────────────────────────────

function populateFilters() {
    const countries = [...new Set(allCourses.map(c => c.country).filter(Boolean))].sort();
    const domains   = DOMAIN_RANGES.map(r => r.label);

    ['vf-country', 'cf-country'].forEach(id => {
        const sel = document.getElementById(id);
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            sel.appendChild(opt);
        });
    });

    ['vf-domain', 'cf-domain'].forEach(id => {
        const sel = document.getElementById(id);
        domains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            sel.appendChild(opt);
        });
    });
}

// ── FILTER EVENTS ─────────────────────────────────────────────────

/**
 * Debounce a function by the given delay.
 * @param {Function} fn
 * @param {number} wait - Milliseconds.
 * @returns {Function}
 */
function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function bindSearchFilter(elementId, filterState, key, onChange) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const debounced = debounce((val) => {
        filterState[key] = val.toLowerCase().trim();
        onChange();
    }, 220);
    el.addEventListener('input', () => debounced(el.value));
}

function bindSelectFilter(elementId, filterState, key, onChange) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.addEventListener('change', () => {
        filterState[key] = el.value;
        onChange();
    });
}

function resetFilterState(state, defaults, inputMap) {
    Object.assign(state, defaults);
    Object.entries(inputMap).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.value = state[key];
    });
}

function initFilters() {
    const refreshVf = () => { vfPage = 1; renderVerificationTab(); };
    const refreshCf = () => { cfPage = 1; renderCoursesTab(); };

    // Verification tab
    bindSearchFilter('vf-search', vfFilter, 'search', refreshVf);
    bindSelectFilter('vf-status', vfFilter, 'status', refreshVf);
    bindSelectFilter('vf-country', vfFilter, 'country', refreshVf);
    bindSelectFilter('vf-domain', vfFilter, 'domain', refreshVf);
    document.getElementById('vf-reset').addEventListener('click', () => {
        resetFilterState(vfFilter, { search: '', status: 'issues', country: 'all', domain: 'all' }, {
            search: 'vf-search', status: 'vf-status', country: 'vf-country', domain: 'vf-domain'
        });
        vfPage = 1;
        renderVerificationTab();
    });

    // All Courses tab
    bindSearchFilter('cf-search', cfFilter, 'search', refreshCf);
    bindSelectFilter('cf-status', cfFilter, 'status', refreshCf);
    bindSelectFilter('cf-country', cfFilter, 'country', refreshCf);
    bindSelectFilter('cf-domain', cfFilter, 'domain', refreshCf);
    bindSelectFilter('cf-qs', cfFilter, 'qs', refreshCf);
    document.getElementById('cf-reset').addEventListener('click', () => {
        resetFilterState(cfFilter, { search: '', status: 'all', country: 'all', domain: 'all', qs: 'any' }, {
            search: 'cf-search', status: 'cf-status', country: 'cf-country', domain: 'cf-domain', qs: 'cf-qs'
        });
        cfPage = 1;
        renderCoursesTab();
    });

    // Pagination
    document.getElementById('vf-prev').addEventListener('click', () => { if (vfPage > 1) { vfPage--; renderVerificationTab(); } });
    document.getElementById('vf-next').addEventListener('click', () => { vfPage++; renderVerificationTab(); });
    document.getElementById('cf-prev').addEventListener('click', () => { if (cfPage > 1) { cfPage--; renderCoursesTab(); } });
    document.getElementById('cf-next').addEventListener('click', () => { cfPage++; renderCoursesTab(); });
}

// ── KPI click-through to Verification tab ────────────────────────
function initKpiClickThrough() {
    document.getElementById('kpi-disc-card').addEventListener('click', () => {
        vfFilter.status = 'Discrepancy';
        vfPage = 1;
        document.getElementById('vf-status').value = 'Discrepancy';
        document.querySelector('.nav-tab[data-tab="tab-verification"]').click();
    });
    document.getElementById('kpi-err-card').addEventListener('click', () => {
        vfFilter.status = 'Error';
        vfPage = 1;
        document.getElementById('vf-status').value = 'Error';
        document.querySelector('.nav-tab[data-tab="tab-verification"]').click();
    });

    document.getElementById('vf-strip').addEventListener('click', e => {
        const card = e.target.closest('.kpi-strip-card');
        if (!card) return;
        document.querySelectorAll('.kpi-strip-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        vfFilter.status = card.dataset.vfStatus;
        vfPage = 1;
        document.getElementById('vf-status').value = card.dataset.vfStatus;
        renderVerificationTab();
    });
}

// ── DASHBOARD ─────────────────────────────────────────────────────

function statusCount(status) {
    return allCourses.filter(c => c.status === status).length;
}

function getDashboardCounts() {
    const total = allCourses.length;
    const verified = statusCount('Verified');
    const disc     = statusCount('Discrepancy');
    const err      = statusCount('Error');
    return {
        total,
        verified,
        disc,
        err,
        pct: total ? Math.round((verified / total) * 100) : 0,
    };
}

function updateDashboardKpis() {
    const counts = getDashboardCounts();
    setText('kpi-verified', counts.verified.toLocaleString());
    setText('kpi-verified-pct', `${counts.pct}% of total`);
    setText('kpi-disc', counts.disc.toLocaleString());
    setText('kpi-err', counts.err.toLocaleString());
    renderStatusDonut(counts.verified, counts.disc, counts.err);
}

function renderDashboard() {
    const counts = getDashboardCounts();
    setText('kpi-total', counts.total.toLocaleString());
    setText('kpi-verified', counts.verified.toLocaleString());
    setText('kpi-verified-pct', `${counts.pct}% of total`);
    setText('kpi-disc', counts.disc.toLocaleString());
    setText('kpi-err', counts.err.toLocaleString());

    renderDomainChart();
    renderStatusDonut(counts.verified, counts.disc, counts.err);
    renderCountryList();
}

function getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        text: isDark ? '#94a3b8' : '#64748b',
        grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    };
}

function renderDomainChart() {
    const counts = {};
    DOMAIN_RANGES.forEach(r => { counts[r.label] = 0; });
    allCourses.forEach(c => {
        const lbl = getDomainLabel(c.id);
        counts[lbl] = (counts[lbl] || 0) + 1;
    });

    const labels = Object.keys(counts);
    const data   = Object.values(counts);
    const { text: textCol, grid: gridCol } = getThemeColors();

    const ctx = document.getElementById('domainBarChart').getContext('2d');
    if (domainChart) domainChart.destroy();

    domainChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: 'rgba(99,102,241,0.6)',
                borderColor:     'rgba(99,102,241,1)',
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
    const ctx = document.getElementById('statusDonut').getContext('2d');
    if (statusChart) statusChart.destroy();

    statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Verified', 'Discrepancy', 'Error'],
            datasets: [{
                data: [verified, disc, err],
                backgroundColor: ['rgba(34,197,94,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)'],
                borderColor:     ['#22c55e', '#f59e0b', '#ef4444'],
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

    const legend = document.getElementById('donut-legend');
    const total  = verified + disc + err;
    legend.innerHTML = [
        { label: 'Verified',     color: '#22c55e', val: verified },
        { label: 'Discrepancy',  color: '#f59e0b', val: disc     },
        { label: 'Error',        color: '#ef4444', val: err      },
    ].map(i => `
        <div class="donut-legend-item">
            <div class="donut-dot" style="background:${i.color}"></div>
            ${escapeHtml(i.label)} — ${i.val.toLocaleString()} (${total ? Math.round((i.val / total) * 100) : 0}%)
        </div>
    `).join('');
}

function renderCountryList() {
    const counts = {};
    allCourses.forEach(c => {
        if (c.country) counts[c.country] = (counts[c.country] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const max = sorted[0]?.[1] || 1;

    document.getElementById('country-list').innerHTML = sorted.map(([name, count], i) => `
        <div class="country-row">
            <div class="country-rank">${i + 1}</div>
            <div class="country-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="country-bar-wrap">
                <div class="country-bar" style="width:${Math.round((count / max) * 100)}%"></div>
            </div>
            <div class="country-count">${count}</div>
        </div>
    `).join('');
}

// ── FILTER PREDICATES ─────────────────────────────────────────────

function courseMatchesBase(c, { status, country, domain }) {
    if (status === 'issues') {
        if (c.status === 'Verified') return false;
    } else if (status !== 'all' && c.status !== status) {
        return false;
    }
    if (country !== 'all' && c.country !== country) return false;
    if (domain !== 'all' && getDomainLabel(c.id) !== domain) return false;
    return true;
}

function courseMatchesSearch(c, query, fieldExtractors) {
    if (!query) return true;
    const hay = fieldExtractors.map(fn => String(fn(c) ?? '')).join(' ').toLowerCase();
    return hay.includes(query);
}

// ── VERIFICATION TAB ──────────────────────────────────────────────

function applyVfFilter(courses) {
    const { search, status, country, domain } = vfFilter;
    return courses.filter(c =>
        courseMatchesBase(c, { status, country, domain }) &&
        courseMatchesSearch(c, search, [
            c => c.name,
            c => c.university,
            c => c.country,
            c => c.disc_reason,
        ])
    );
}

function clampPage(page, totalPages) {
    return Math.max(1, Math.min(page, totalPages || 1));
}

function updatePaginationUi(page, totalPages, infoId, prevId, nextId, totalItems) {
    setText(infoId, `Page ${page} of ${totalPages} (${totalItems.toLocaleString()} courses)`);
    const prevBtn = document.getElementById(prevId);
    const nextBtn = document.getElementById(nextId);
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
}

function renderEmptyRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function renderVerificationRow(c, idx) {
    return `<tr data-id="${escapeHtml(Number(c.id))}" title="Click to view details">
        <td>${idx}</td>
        <td title="${escapeHtml(c.name || '')}" style="max-width:260px;">${escapeHtml(c.name)}</td>
        <td title="${escapeHtml(c.university || '')}">${escapeHtml(c.university || '—')}</td>
        <td>${escapeHtml(c.country || '—')}</td>
        <td><span style="font-size:0.78rem;color:var(--text-muted);">${getDomainLabel(c.id)}</span></td>
        <td>${badgeHtml(c.status)}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.disc_reason || c.issue_sub_type || '')}">${escapeHtml(c.disc_reason || c.issue_sub_type || '—')}</td>
    </tr>`;
}

function renderVerificationTab() {
    const filtered   = applyVfFilter(allCourses);
    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    vfPage = clampPage(vfPage, totalPages);
    const start = (vfPage - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    setText('vfs-total', total.toLocaleString());
    setText('vfs-disc', statusCount('Discrepancy').toLocaleString());
    setText('vfs-err', statusCount('Error').toLocaleString());
    setText('vfs-ver', statusCount('Verified').toLocaleString());

    const tbody = document.getElementById('vf-tbody');
    tbody.innerHTML = slice.length
        ? slice.map((c, i) => renderVerificationRow(c, start + i + 1)).join('')
        : renderEmptyRow(7, 'No courses match the current filters.');

    updatePaginationUi(vfPage, totalPages, 'vf-pag-info', 'vf-prev', 'vf-next', total);
}

// ── ALL COURSES TAB ─────────────────────────────────────────────────

function applyCfFilter(courses) {
    const { search, status, country, domain, qs } = cfFilter;
    return courses.filter(c => {
        if (!courseMatchesBase(c, { status, country, domain })) return false;
        if (qs === 'yes' && !c.has_qs_badge) return false;
        if (qs === 'no'  &&  c.has_qs_badge) return false;
        return courseMatchesSearch(c, search, [
            c => c.name,
            c => c.university,
            c => c.country,
            c => c.skills,
        ]);
    });
}

function renderCoursesRow(c, idx) {
    const qsBadge = c.has_qs_badge
        ? '<span class="badge" style="background:var(--blue-bg);color:var(--blue);border:1px solid rgba(59,130,246,0.25);">QS ✓</span>'
        : '—';
    return `<tr data-id="${escapeHtml(Number(c.id))}" title="Click to view details">
        <td>${idx}</td>
        <td title="${escapeHtml(c.name || '')}">${escapeHtml(c.name)}</td>
        <td title="${escapeHtml(c.university || '')}">${escapeHtml(c.university || '—')}</td>
        <td>${escapeHtml(c.country || '—')}</td>
        <td><span style="font-size:0.78rem;color:var(--text-muted);">${getDomainLabel(c.id)}</span></td>
        <td>${qsBadge}</td>
        <td>${badgeHtml(c.status)}</td>
    </tr>`;
}

function renderCoursesTab() {
    const filtered   = applyCfFilter(allCourses);
    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    cfPage = clampPage(cfPage, totalPages);
    const start = (cfPage - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('cf-tbody');
    tbody.innerHTML = slice.length
        ? slice.map((c, i) => renderCoursesRow(c, start + i + 1)).join('')
        : renderEmptyRow(7, 'No courses match the current filters.');

    updatePaginationUi(cfPage, totalPages, 'cf-pag-info', 'cf-prev', 'cf-next', total);
}

// ── TABLE CLICK DELEGATION ─────────────────────────────────────────

function initTableClicks() {
    ['vf-tbody', 'cf-tbody'].forEach(id => {
        const tbody = document.getElementById(id);
        if (!tbody) return;
        tbody.addEventListener('click', e => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            openModal(Number(row.dataset.id));
        });
    });
}

// ── MODAL ─────────────────────────────────────────────────────────

function initModal() {
    const modal = document.getElementById('course-modal');
    document.getElementById('modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });
    document.getElementById('modal-solve-all').addEventListener('click', solveAll);

    document.getElementById('modal-tbody').addEventListener('click', e => {
        const btn = e.target.closest('[data-action="solve"]');
        if (!btn || !modalCourse) return;
        const attr = btn.dataset.attr;
        const isSolved = btn.dataset.solved === 'true';
        solveAttr(Number(modalCourse.id), attr, isSolved);
    });
}

function isMismatchRow(r) {
    if (!r) return false;
    if (r.status) return String(r.status).toUpperCase() !== 'MATCH';
    return r.original !== r.verified;
}

async function openModal(courseId) {
    const cBase = allCourses.find(x => x.id == courseId);
    if (!cBase) return;

    setText('modal-title', cBase.name || '—');
    setText('modal-sub', 'Fetching details from database...');
    document.getElementById('modal-meta').innerHTML = '';
    document.getElementById('modal-tbody').innerHTML = renderEmptyRow(5, 'Loading comparison data...');
    document.getElementById('course-modal').classList.add('open');

    try {
        const res = await fetch(`/api/get_course_details?id=${encodeURIComponent(courseId)}`);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`API error ${res.status}: ${err}`);
        }
        const data = await res.json();
        const c = data.document;
        if (!c) throw new Error('Course not found');
        modalCourse = c;

        setText('modal-sub', `${c.university || '—'}  ·  ${c.country || '—'}  ·  Page ${c.pdf_page || '?'}`);

        const badge = document.getElementById('modal-badge');
        badge.className = 'badge badge-' + (c.status || '').toLowerCase();
        badge.textContent = c.status || '—';

        document.getElementById('modal-meta').innerHTML = [
            ['Cost',     c.cost],
            ['Duration', c.duration],
            ['Mode',     c.mode],
            ['Domain',   getDomainLabel(c.id)],
            ['QS',       c.has_qs_badge ? '✓ Ranked' : '—'],
            ['NIRF',     c.has_nirf_badge ? '✓ Ranked' : '—'],
        ].map(([k, v]) => `<div class="meta-chip"><strong>${k}:</strong> ${escapeHtml(String(v || '—'))}</div>`).join('');

        const rows = c.pdf_table || [];
        const solved = c.solved_attrs || [];
        const hasMismatch = rows.some(isMismatchRow);

        if (!rows.length) {
            document.getElementById('modal-tbody').innerHTML = renderEmptyRow(5, 'No comparison data available.');
        } else {
            document.getElementById('modal-tbody').innerHTML = rows.map(r => {
                const isSolved  = solved.includes((r.attribute || '').toLowerCase());
                const mismatch  = isMismatchRow(r);
                const rowClass  = isSolved ? 'solved-row' : mismatch ? 'mismatch-row' : '';
                const matchIcon = mismatch
                    ? '<span class="match-icon match-no">✕</span>'
                    : '<span class="match-icon match-yes">✓</span>';
                const actionCell = mismatch
                    ? `<button class="btn-solve ${isSolved ? 'solved' : ''}"
                           data-action="solve"
                           data-attr="${escapeHtml(r.attribute || '')}"
                           data-solved="${isSolved}"
                           title="${isSolved ? 'Undo resolve' : 'Mark as resolved'}">
                           ${isSolved ? '✓ Solved' : 'Solve'}
                       </button>`
                    : '<span style="color:var(--text-dim);font-size:0.78rem;">OK</span>';
                return `<tr class="${rowClass}">
                    <td>${escapeHtml(r.attribute || '—')}</td>
                    <td>${escapeHtml(r.original  || '—')}</td>
                    <td>${escapeHtml(r.verified  || '—')}</td>
                    <td>${matchIcon}</td>
                    <td>${actionCell}</td>
                </tr>`;
            }).join('');
        }

        const allSolved = rows.every(r => !isMismatchRow(r) || solved.includes((r.attribute || '').toLowerCase()));
        document.getElementById('modal-hint').textContent = c.disc_reason || '';
        const solveAllBtn = document.getElementById('modal-solve-all');
        solveAllBtn.style.display = (hasMismatch && c.status !== 'Verified') ? 'inline-flex' : 'none';
        solveAllBtn.textContent   = allSolved ? '✓ All Resolved' : '✓ Mark All Resolved';

    } catch (err) {
        document.getElementById('modal-tbody').innerHTML = `<tr><td colspan="5" class="empty-state" style="color:var(--red)">Error loading details: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function closeModal() {
    document.getElementById('course-modal').classList.remove('open');
    modalCourse = null;
}

// ── SOLVE ─────────────────────────────────────────────────────────

/**
 * Persist a course update optimistically, refreshing tabs on success
 * and reverting local state on failure.
 * @param {Object} course - Local course object to mutate.
 * @param {Object} update - Changes to send to the API.
 * @param {Object} snapshot - Previous values for rollback.
 * @returns {Promise<boolean>} Whether the save succeeded.
 */
async function persistCourseUpdate(course, update, snapshot) {
    Object.assign(course, update);
    try {
        await mongoUpdateCourse(course.id, update);
        renderVerificationTab();
        renderCoursesTab();
        return true;
    } catch (err) {
        Object.assign(course, snapshot);
        alert('Failed to save: ' + err.message);
        return false;
    }
}

async function solveAttr(courseId, attr, isSolved) {
    const c = allCourses.find(x => x.id == courseId);
    if (!c || !attr) return;

    const key = attr.toLowerCase();
    const snapshot = {
        solved_attrs: c.solved_attrs ? [...c.solved_attrs] : [],
        status: c.status,
        issue_category: c.issue_category,
    };

    let solved = [...snapshot.solved_attrs];
    if (isSolved) {
        solved = solved.filter(s => s !== key);
    } else if (!solved.includes(key)) {
        solved.push(key);
    }

    const rows = c.pdf_table || [];
    const mismatchAttrs = rows.filter(isMismatchRow).map(r => (r.attribute || '').toLowerCase());
    const allSolvedNow = mismatchAttrs.every(a => solved.includes(a));

    const update = {
        solved_attrs: solved,
        status: allSolvedNow ? 'Verified' : snapshot.status,
        issue_category: allSolvedNow ? 'verified' : snapshot.issue_category,
    };

    if (await persistCourseUpdate(c, update, snapshot)) {
        openModal(courseId);
        updateDashboardKpis();
    }
}

async function solveAll() {
    if (!modalCourse) return;
    const c = modalCourse;
    const rows = c.pdf_table || [];
    const solved = rows.map(r => (r.attribute || '').toLowerCase()).filter(Boolean);

    const snapshot = {
        solved_attrs: c.solved_attrs ? [...c.solved_attrs] : [],
        status: c.status,
        issue_category: c.issue_category,
    };

    const update = {
        solved_attrs: solved,
        status: 'Verified',
        issue_category: 'verified',
    };

    if (await persistCourseUpdate(c, update, snapshot)) {
        openModal(c.id);
    }
}

// ── HELPERS ───────────────────────────────────────────────────────

/**
 * Safely set text content of an element by ID.
 * @param {string} id
 * @param {string} val
 */
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/**
 * Escape a value for safe use in HTML text or attributes.
 * @param {any} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str ?? '')
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
    return `<span class="badge ${cls}">${escapeHtml(status || '—')}</span>`;
}