/* ================================================================
   COURSE VERIFIER · app.js
   All-in-one frontend: Vercel Serverless API + Client-side logic
   ================================================================ */

'use strict';

/* ================================================================
   Domain ranges: each course ID maps to exactly one category.
   ================================================================ */
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
 * Resolve the domain label for a course ID.
 * Falls back to 'Uncategorised' for missing/out-of-range IDs.
 */
function getDomainLabel(courseId) {
    const id = parseInt(courseId, 10);
    if (Number.isNaN(id)) return 'Uncategorised';

    for (const range of DOMAIN_RANGES) {
        if (id >= range.min && id <= range.max) return range.label;
    }
    return 'Uncategorised';
}

/* ================================================================
   Application state
   ================================================================ */
let allCourses = [];                 // Full course dataset, enriched after fetch
let domainBarChart = null;           // Chart.js instance for domain bar chart
let statusDonutChart = null;         // Chart.js instance for status donut chart

let verificationPage = 1;            // Current page on the Verification tab
let coursesPage = 1;                 // Current page on the All Courses tab
const PAGE_SIZE = 100;

let verificationFilter = { search: '', status: 'issues', country: 'all', domain: 'all' };
let coursesFilter    = { search: '', status: 'all',     country: 'all', domain: 'all', qs: 'any' };

let activeModalCourse = null;        // Course currently displayed in the modal

/* ================================================================
   API fetchers
   ================================================================ */

/**
 * Fetch every course from the Vercel API.
 */
async function fetchAllCourses() {
    setLoaderSubtitle('Fetching courses from database…');
    const response = await fetch('/api/get_courses');
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    const documents = data.documents || [];
    setLoaderSubtitle(`Loaded ${documents.length} courses…`);
    return documents;
}

/**
 * Persist an updated course back to MongoDB via the Vercel API.
 */
async function updateCourse(courseId, update) {
    const response = await fetch('/api/solve_course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseId, update })
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    return response.json();
}

/* ================================================================
   Loader / connection helpers
   ================================================================ */

function setLoaderSubtitle(text) {
    const element = document.getElementById('loader-sub');
    if (element) element.textContent = text;
}

function setConnectionState(state) {
    const dot = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (!dot || !label) return;

    dot.className = 'status-dot ' + state;
    label.textContent = state === 'connected' ? 'Connected'
                      : state === 'error'     ? 'Error'
                      : 'Connecting';
}

/* ================================================================
   DOM utilities
   ================================================================ */

function byId(id) {
    return document.getElementById(id);
}

function setElementText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeJsString(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function getStatusBadgeHtml(status) {
    const className = {
        Verified:    'badge-verified',
        Discrepancy: 'badge-discrepancy',
        Error:       'badge-error',
    }[status] || 'badge-error';
    return `<span class="badge ${className}">${escapeHtml(status || '—')}</span>`;
}

/* ================================================================
   Debounce helper for search inputs
   ================================================================ */
function debounce(fn, delayMs) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delayMs);
    };
}

/* ================================================================
   Bootstrap on DOM ready
   ================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initTabs();

    try {
        setConnectionState('connecting');
        allCourses = enrichCourseData(await fetchAllCourses());
        setConnectionState('connected');

        byId('loading-screen').style.display = 'none';
        byId('main-page').style.display = 'block';

        populateFilters();
        renderDashboard();
        renderVerificationTab();
        renderCoursesTab();

        initFilters();
        initModal();
        initKpiClickThrough();
    } catch (error) {
        setConnectionState('error');
        setLoaderSubtitle('Connection failed: ' + error.message);
        console.error('[MongoFetch]', error);
    }
});

/* ================================================================
   Data enrichment (performs once after fetch)
   ================================================================ */

/**
 * Add derived/cached fields to every course so filtering and
 * rendering avoid recomputing the same values repeatedly.
 */
function enrichCourseData(courses) {
    courses.forEach(course => {
        course.domainLabel = getDomainLabel(course.id);
        course._vfSearchIndex = buildSearchIndex(course, ['name', 'university', 'country', 'disc_reason']);
        course._cfSearchIndex = buildSearchIndex(course, ['name', 'university', 'country', 'skills']);
    });
    return courses;
}

function buildSearchIndex(course, fields) {
    return fields
        .map(field => String(course[field] || '').toLowerCase())
        .join(' ');
}

/* ================================================================
   Theme
   ================================================================ */

function initTheme() {
    const savedTheme = localStorage.getItem('cv_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    byId('theme-btn').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const nextTheme = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('cv_theme', nextTheme);
        updateThemeIcon(nextTheme);
        // Re-render charts so they pick up the new palette
        renderDashboard();
    });
}

function updateThemeIcon(theme) {
    const icon = byId('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀' : '🌙';
}

/* ================================================================
   Tabs
   ================================================================ */

function initTabs() {
    byId('nav-tabs').addEventListener('click', event => {
        const tabLink = event.target.closest('.nav-tab');
        if (!tabLink) return;

        event.preventDefault();
        const targetId = tabLink.dataset.tab;

        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));

        tabLink.classList.add('active');
        byId(targetId).classList.add('active');
    });
}

/* ================================================================
   Filter dropdown population
   ================================================================ */

function populateFilters() {
    const countries = [...new Set(allCourses.map(course => course.country).filter(Boolean))].sort();
    const domains = DOMAIN_RANGES.map(range => range.label);

    ['vf-country', 'cf-country'].forEach(selectId => {
        const select = byId(selectId);
        const fragment = document.createDocumentFragment();
        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            fragment.appendChild(option);
        });
        select.appendChild(fragment);
    });

    ['vf-domain', 'cf-domain'].forEach(selectId => {
        const select = byId(selectId);
        const fragment = document.createDocumentFragment();
        domains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            fragment.appendChild(option);
        });
        select.appendChild(fragment);
    });
}

/* ================================================================
   Filter events
   ================================================================ */

function initFilters() {
    // Verification tab
    byId('vf-search').addEventListener('input', debounce(event => {
        verificationFilter.search = event.target.value.toLowerCase();
        verificationPage = 1;
        renderVerificationTab();
    }, 220));

    byId('vf-status').addEventListener('change', event => {
        verificationFilter.status = event.target.value;
        verificationPage = 1;
        renderVerificationTab();
    });

    byId('vf-country').addEventListener('change', event => {
        verificationFilter.country = event.target.value;
        verificationPage = 1;
        renderVerificationTab();
    });

    byId('vf-domain').addEventListener('change', event => {
        verificationFilter.domain = event.target.value;
        verificationPage = 1;
        renderVerificationTab();
    });

    byId('vf-reset').addEventListener('click', () => {
        verificationFilter = { search: '', status: 'issues', country: 'all', domain: 'all' };
        byId('vf-search').value = '';
        byId('vf-status').value  = 'issues';
        byId('vf-country').value = 'all';
        byId('vf-domain').value  = 'all';
        verificationPage = 1;
        renderVerificationTab();
    });

    // All Courses tab
    byId('cf-search').addEventListener('input', debounce(event => {
        coursesFilter.search = event.target.value.toLowerCase();
        coursesPage = 1;
        renderCoursesTab();
    }, 220));

    byId('cf-status').addEventListener('change', event => {
        coursesFilter.status = event.target.value;
        coursesPage = 1;
        renderCoursesTab();
    });

    byId('cf-country').addEventListener('change', event => {
        coursesFilter.country = event.target.value;
        coursesPage = 1;
        renderCoursesTab();
    });

    byId('cf-domain').addEventListener('change', event => {
        coursesFilter.domain = event.target.value;
        coursesPage = 1;
        renderCoursesTab();
    });

    byId('cf-qs').addEventListener('change', event => {
        coursesFilter.qs = event.target.value;
        coursesPage = 1;
        renderCoursesTab();
    });

    byId('cf-reset').addEventListener('click', () => {
        coursesFilter = { search: '', status: 'all', country: 'all', domain: 'all', qs: 'any' };
        byId('cf-search').value  = '';
        byId('cf-status').value  = 'all';
        byId('cf-country').value = 'all';
        byId('cf-domain').value  = 'all';
        byId('cf-qs').value      = 'any';
        coursesPage = 1;
        renderCoursesTab();
    });

    // Pagination
    byId('vf-prev').addEventListener('click', () => {
        if (verificationPage > 1) {
            verificationPage--;
            renderVerificationTab();
        }
    });

    byId('vf-next').addEventListener('click', () => {
        const totalPages = getVerificationTotalPages();
        if (verificationPage < totalPages) {
            verificationPage++;
            renderVerificationTab();
        }
    });

    byId('cf-prev').addEventListener('click', () => {
        if (coursesPage > 1) {
            coursesPage--;
            renderCoursesTab();
        }
    });

    byId('cf-next').addEventListener('click', () => {
        const totalPages = getCoursesTotalPages();
        if (coursesPage < totalPages) {
            coursesPage++;
            renderCoursesTab();
        }
    });
}

/* ================================================================
   KPI click-through to the Verification tab
   ================================================================ */

function initKpiClickThrough() {
    byId('kpi-disc-card').addEventListener('click', () => {
        verificationFilter.status = 'Discrepancy';
        verificationPage = 1;
        byId('vf-status').value = 'Discrepancy';
        byId('nav-tab-verification')?.click();
    });

    byId('kpi-err-card').addEventListener('click', () => {
        verificationFilter.status = 'Error';
        verificationPage = 1;
        byId('vf-status').value = 'Error';
        byId('nav-tab-verification')?.click();
    });

    byId('vf-strip').addEventListener('click', event => {
        const card = event.target.closest('.kpi-strip-card');
        if (!card) return;

        document.querySelectorAll('.kpi-strip-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        const status = card.dataset.vfStatus;
        verificationFilter.status = status;
        verificationPage = 1;
        byId('vf-status').value = status;
        renderVerificationTab();
    });
}

/* ================================================================
   Dashboard
   ================================================================ */

function renderDashboard() {
    const counts = computeStatusCounts();
    const verifiedPercent = counts.total ? Math.round((counts.verified / counts.total) * 100) : 0;

    setElementText('kpi-total',        counts.total.toLocaleString());
    setElementText('kpi-verified',     counts.verified.toLocaleString());
    setElementText('kpi-verified-pct', `${verifiedPercent}% of total`);
    setElementText('kpi-disc',         counts.discrepancy.toLocaleString());
    setElementText('kpi-err',          counts.error.toLocaleString());

    renderDomainChart();
    renderStatusDonut(counts.verified, counts.discrepancy, counts.error);
    renderCountryList();
}

/**
 * Count statuses in a single pass over allCourses.
 */
function computeStatusCounts() {
    let total = 0;
    let verified = 0;
    let discrepancy = 0;
    let error = 0;

    for (const course of allCourses) {
        total++;
        if (course.status === 'Verified') verified++;
        else if (course.status === 'Discrepancy') discrepancy++;
        else if (course.status === 'Error') error++;
    }

    return { total, verified, discrepancy, error };
}

function renderDomainChart() {
    const counts = {};
    DOMAIN_RANGES.forEach(range => { counts[range.label] = 0; });

    for (const course of allCourses) {
        counts[course.domainLabel] = (counts[course.domainLabel] || 0) + 1;
    }

    const labels = Object.keys(counts);
    const data = Object.values(counts);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const ctx = byId('domainBarChart').getContext('2d');
    if (domainBarChart) domainBarChart.destroy();

    domainBarChart = new Chart(ctx, {
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
                x: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
                y: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: true },
            },
        },
    });
}

function renderStatusDonut(verified, discrepancy, error) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const ctx = byId('statusDonut').getContext('2d');
    if (statusDonutChart) statusDonutChart.destroy();

    statusDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Verified', 'Discrepancy', 'Error'],
            datasets: [{
                data: [verified, discrepancy, error],
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

    // Custom HTML legend beneath the donut
    const legend = byId('donut-legend');
    const total = verified + discrepancy + error;
    const items = [
        { label: 'Verified',    color: '#22c55e', value: verified },
        { label: 'Discrepancy', color: '#f59e0b', value: discrepancy },
        { label: 'Error',       color: '#ef4444', value: error },
    ];

    legend.innerHTML = items.map(item => {
        const percent = total ? Math.round((item.value / total) * 100) : 0;
        return `
            <div class="donut-legend-item">
                <div class="donut-dot" style="background:${item.color}"></div>
                ${item.label} — ${item.value.toLocaleString()} (${percent}%)
            </div>
        `;
    }).join('');
}

function renderCountryList() {
    const counts = {};
    for (const course of allCourses) {
        if (course.country) {
            counts[course.country] = (counts[course.country] || 0) + 1;
        }
    }

    const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

    const maxCount = sorted[0]?.[1] || 1;

    byId('country-list').innerHTML = sorted.map(([name, count], index) => {
        const width = Math.round((count / maxCount) * 100);
        return `
            <div class="country-row">
                <div class="country-rank">${index + 1}</div>
                <div class="country-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                <div class="country-bar-wrap">
                    <div class="country-bar" style="width:${width}%"></div>
                </div>
                <div class="country-count">${count}</div>
            </div>
        `;
    }).join('');
}

/* ================================================================
   Verification tab
   ================================================================ */

function filterVerificationCourses(courses) {
    const { search, status, country, domain } = verificationFilter;
    const normalizedSearch = search.trim();

    return courses.filter(course => {
        if (status === 'issues') {
            if (course.status === 'Verified') return false;
        } else if (status !== 'all' && course.status !== status) {
            return false;
        }

        if (country !== 'all' && course.country !== country) return false;
        if (domain !== 'all' && course.domainLabel !== domain) return false;

        if (normalizedSearch && !course._vfSearchIndex.includes(normalizedSearch)) return false;

        return true;
    });
}

function getVerificationTotalPages() {
    const filtered = filterVerificationCourses(allCourses);
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
}

function renderVerificationTab() {
    const filtered = filterVerificationCourses(allCourses);
    const total = filtered.length;
    const totalPages = getVerificationTotalPages();
    if (verificationPage > totalPages) verificationPage = totalPages;

    const start = (verificationPage - 1) * PAGE_SIZE;
    const pageSlice = filtered.slice(start, start + PAGE_SIZE);

    // KPI strip uses global counts so the totals stay stable while filtering
    const counts = computeStatusCounts();
    setElementText('vfs-total', counts.verified.toLocaleString());
    setElementText('vfs-disc',  counts.discrepancy.toLocaleString());
    setElementText('vfs-err',   counts.error.toLocaleString());
    setElementText('vfs-ver',   counts.verified.toLocaleString());

    const tbody = byId('vf-tbody');
    if (!pageSlice.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No courses match the current filters.</td></tr>';
    } else {
        tbody.innerHTML = pageSlice.map((course, index) => `
            <tr onclick="openModal(${course.id})" title="Click to view details">
                <td>${start + index + 1}</td>
                <td title="${escapeHtml(course.name)}" style="max-width:260px;">${escapeHtml(course.name)}</td>
                <td title="${escapeHtml(course.university)}">${escapeHtml(course.university || '—')}</td>
                <td>${escapeHtml(course.country || '—')}</td>
                <td><span style="font-size:0.78rem; color:var(--text-muted);">${course.domainLabel}</span></td>
                <td>${getStatusBadgeHtml(course.status)}</td>
                <td style="font-size:0.78rem; color:var(--text-muted); max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(course.disc_reason || course.issue_sub_type || '')}">${escapeHtml(course.disc_reason || course.issue_sub_type || '—')}</td>
            </tr>
        `).join('');
    }

    setElementText('vf-pag-info', `Page ${verificationPage} of ${totalPages} (${total.toLocaleString()} courses)`);
    byId('vf-prev').disabled = verificationPage <= 1;
    byId('vf-next').disabled = verificationPage >= totalPages;
}

/* ================================================================
   All Courses tab
   ================================================================ */

function filterAllCourses(courses) {
    const { search, status, country, domain, qs } = coursesFilter;
    const normalizedSearch = search.trim();

    return courses.filter(course => {
        if (status !== 'all' && course.status !== status) return false;
        if (country !== 'all' && course.country !== country) return false;
        if (domain !== 'all' && course.domainLabel !== domain) return false;

        if (qs === 'yes' && !course.has_qs_badge) return false;
        if (qs === 'no'  &&  course.has_qs_badge) return false;

        if (normalizedSearch && !course._cfSearchIndex.includes(normalizedSearch)) return false;

        return true;
    });
}

function getCoursesTotalPages() {
    const filtered = filterAllCourses(allCourses);
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
}

function renderCoursesTab() {
    const filtered = filterAllCourses(allCourses);
    const total = filtered.length;
    const totalPages = getCoursesTotalPages();
    if (coursesPage > totalPages) coursesPage = totalPages;

    const start = (coursesPage - 1) * PAGE_SIZE;
    const pageSlice = filtered.slice(start, start + PAGE_SIZE);

    const tbody = byId('cf-tbody');
    if (!pageSlice.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No courses match the current filters.</td></tr>';
    } else {
        tbody.innerHTML = pageSlice.map((course, index) => `
            <tr onclick="openModal(${course.id})" title="Click to view details">
                <td>${start + index + 1}</td>
                <td title="${escapeHtml(course.name)}">${escapeHtml(course.name)}</td>
                <td title="${escapeHtml(course.university)}">${escapeHtml(course.university || '—')}</td>
                <td>${escapeHtml(course.country || '—')}</td>
                <td><span style="font-size:0.78rem; color:var(--text-muted);">${course.domainLabel}</span></td>
                <td>${course.has_qs_badge ? '<span class="badge" style="background:var(--blue-bg);color:var(--blue);border:1px solid rgba(59,130,246,0.25);">QS ✓</span>' : '—'}</td>
                <td>${getStatusBadgeHtml(course.status)}</td>
            </tr>
        `).join('');
    }

    setElementText('cf-pag-info', `Page ${coursesPage} of ${totalPages} (${total.toLocaleString()} courses)`);
    byId('cf-prev').disabled = coursesPage <= 1;
    byId('cf-next').disabled = coursesPage >= totalPages;
}

/* ================================================================
   Modal
   ================================================================ */

function initModal() {
    byId('modal-close').addEventListener('click', closeModal);
    byId('course-modal').addEventListener('click', event => {
        if (event.target === event.currentTarget) closeModal();
    });
    byId('modal-solve-all').addEventListener('click', solveAll);
}

async function openModal(courseId) {
    const baseCourse = allCourses.find(course => course.id == courseId);
    if (!baseCourse) return;

    // Show immediate skeleton while heavy details load
    setElementText('modal-title', baseCourse.name || '—');
    setElementText('modal-sub', 'Fetching details from database…');
    byId('modal-meta').innerHTML = '';
    byId('modal-tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Loading comparison data…</td></tr>';
    byId('course-modal').classList.add('open');

    try {
        const response = await fetch(`/api/get_course_details?id=${courseId}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        const course = data.document;
        if (!course) throw new Error('Course not found');

        activeModalCourse = course;

        setElementText('modal-sub', `${course.university || '—'} · ${course.country || '—'} · Page ${course.pdf_page || '?'}`);

        const badge = byId('modal-badge');
        badge.className = 'badge badge-' + (course.status || '').toLowerCase();
        badge.textContent = course.status || '—';

        // Meta chips
        byId('modal-meta').innerHTML = [
            ['Cost',     course.cost],
            ['Duration', course.duration],
            ['Mode',     course.mode],
            ['Domain',   getDomainLabel(course.id)],
            ['QS',       course.has_qs_badge ? '✓ Ranked' : '—'],
            ['NIRF',     course.has_nirf_badge ? '✓ Ranked' : '—'],
        ].map(([label, value]) => `
            <div class="meta-chip"><strong>${label}:</strong> ${escapeHtml(String(value || '—'))}</div>
        `).join('');

        // Comparison table
        const rows = course.pdf_table || [];
        const solved = course.solved_attrs || [];
        const hasMismatch = rows.some(isTableRowMismatch);

        const tbody = byId('modal-tbody');
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No comparison data available.</td></tr>';
        } else {
            tbody.innerHTML = rows.map(row => {
                const solvedKey = String(row.attribute || '').toLowerCase();
                const isSolved = solved.includes(solvedKey);
                const isMismatch = isTableRowMismatch(row);
                const rowClass = isSolved ? 'solved-row' : isMismatch ? 'mismatch-row' : '';
                const matchIcon = isMismatch
                    ? '<span class="match-icon match-no">✕</span>'
                    : '<span class="match-icon match-yes">✓</span>';
                const actionButton = isMismatch
                    ? `<button class="btn-solve ${isSolved ? 'solved' : ''}"
                           onclick="solveAttr(${course.id}, '${escapeJsString(row.attribute)}', ${isSolved})"
                           title="${isSolved ? 'Undo resolve' : 'Mark as resolved'}">
                           ${isSolved ? '✓ Solved' : 'Solve'}
                       </button>`
                    : '<span style="color:var(--text-dim); font-size:0.78rem;">OK</span>';

                return `<tr class="${rowClass}">
                    <td>${escapeHtml(row.attribute || '—')}</td>
                    <td>${escapeHtml(row.original  || '—')}</td>
                    <td>${escapeHtml(row.verified  || '—')}</td>
                    <td>${matchIcon}</td>
                    <td>${actionButton}</td>
                </tr>`;
            }).join('');
        }

        // Hint and bulk-resolve button
        byId('modal-hint').textContent = course.disc_reason || '';
        const solveAllBtn = byId('modal-solve-all');
        const allResolved = rows.every(row => {
            if (!isTableRowMismatch(row)) return true;
            return solved.includes(String(row.attribute || '').toLowerCase());
        });

        solveAllBtn.style.display = (hasMismatch && course.status !== 'Verified') ? 'inline-flex' : 'none';
        solveAllBtn.textContent = allResolved ? '✓ All Resolved' : '✓ Mark All Resolved';

    } catch (error) {
        byId('modal-tbody').innerHTML = `<tr><td colspan="5" class="empty-state" style="color:var(--red)">Error loading details: ${escapeHtml(error.message)}</td></tr>`;
    }
}

function closeModal() {
    byId('course-modal').classList.remove('open');
    activeModalCourse = null;
}

/* ================================================================
   Resolve / solve actions
   ================================================================ */

/**
 * Toggle a single comparison attribute as resolved/unresolved.
 */
async function solveAttr(courseId, attribute, isSolved) {
    const course = allCourses.find(c => c.id == courseId);
    if (!course) return;

    // Snapshot current state so we can roll back on API failure
    const previousSolved = Array.isArray(course.solved_attrs) ? [...course.solved_attrs] : [];
    const previousStatus = course.status;

    const key = String(attribute || '').toLowerCase();
    const solvedSet = new Set(previousSolved.map(a => String(a).toLowerCase()));

    if (isSolved) {
        solvedSet.delete(key);
    } else {
        solvedSet.add(key);
    }

    const solvedArray = Array.from(solvedSet);

    // If every mismatched attribute is resolved, mark the whole course Verified
    const rows = course.pdf_table || [];
    const mismatchAttributes = rows
        .filter(isTableRowMismatch)
        .map(r => String(r.attribute || '').toLowerCase());

    const allResolved = mismatchAttributes.every(attrKey => solvedSet.has(attrKey));
    const update = {
        solved_attrs:   solvedArray,
        status:         allResolved ? 'Verified' : course.status,
        issue_category: allResolved ? 'verified' : course.issue_category,
    };

    Object.assign(course, update);

    try {
        await updateCourse(courseId, update);
        openModal(courseId);
        renderVerificationTab();
        renderCoursesTab();
        refreshDashboardKpis();
    } catch (error) {
        // Roll back the optimistic local update
        course.solved_attrs = previousSolved;
        course.status = previousStatus;
        alert('Failed to save: ' + error.message);
    }
}

/**
 * Mark every mismatched comparison attribute as resolved at once.
 */
async function solveAll() {
    if (!activeModalCourse) return;

    const course = activeModalCourse;
    const rows = course.pdf_table || [];
    const solvedKeys = rows
        .map(r => String(r.attribute || '').toLowerCase())
        .filter(Boolean);

    const update = {
        solved_attrs:   solvedKeys,
        status:         'Verified',
        issue_category: 'verified',
    };

    const localCourse = allCourses.find(c => c.id == course.id);
    const previousLocalState = localCourse
        ? { solved_attrs: Array.isArray(localCourse.solved_attrs) ? [...localCourse.solved_attrs] : [], status: localCourse.status }
        : null;

    if (localCourse) Object.assign(localCourse, update);

    try {
        await updateCourse(course.id, update);
        openModal(course.id);
        renderVerificationTab();
        renderCoursesTab();
        refreshDashboardKpis();
    } catch (error) {
        if (localCourse && previousLocalState) {
            localCourse.solved_attrs = previousLocalState.solved_attrs;
            localCourse.status = previousLocalState.status;
        }
        alert('Failed to save: ' + error.message);
    }
}

function refreshDashboardKpis() {
    const counts = computeStatusCounts();
    const verifiedPercent = counts.total ? Math.round((counts.verified / counts.total) * 100) : 0;

    setElementText('kpi-verified',     counts.verified.toLocaleString());
    setElementText('kpi-verified-pct', `${verifiedPercent}% of total`);
    setElementText('kpi-disc',         counts.discrepancy.toLocaleString());
    setElementText('kpi-err',          counts.error.toLocaleString());

    renderStatusDonut(counts.verified, counts.discrepancy, counts.error);
}

/* ================================================================
   Comparison-row helpers
   ================================================================ */

function isTableRowMismatch(row) {
    if (row.status) return row.status.toUpperCase() !== 'MATCH';
    return row.original !== row.verified;
}