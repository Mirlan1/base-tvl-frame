const express = require('express');
const fetch = require('node-fetch');
const moment = require('moment');

const router = express.Router();

// In-memory cache
let protocols = [];
let lastFetched = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// Utility: fetch protocols from DefiLlama and filter by chain 'Base'
async function fetchProtocols(force = false) {
  const now = Date.now();
  if (!force && protocols.length && (now - lastFetched) < CACHE_TTL) {
    return protocols;
  }
  try {
    const res = await fetch('https://api.llama.fi/protocols');
    const all = await res.json();

    // filter projects where 'Base' is listed in chains
    const baseOnly = all
      .filter(p => Array.isArray(p.chains) && p.chains.includes('Base'))
      .map(p => ({
        id: p.id || p.slug || p.name,
        name: p.name,
        slug: p.slug || (p.name && p.name.toLowerCase().replace(/\s+/g, '-')),
        tvl: typeof p.tvl === 'number' ? p.tvl : (p.tvlUsd || 0),
        change_7d: typeof p.change_7d === 'number' ? p.change_7d : (p.change_30d || 0),
        category: p.category || 'Unknown',
        chains: p.chains || [],
        tokens: p.tokens || [],
        logo: p.logo,
        description: p.description || ''
      }));

    protocols = baseOnly;
    lastFetched = Date.now();
    return protocols;
  } catch (e) {
    console.error('Failed to fetch protocols:', e);
    return protocols;
  }
}

// Utility: paginate function
function paginate(arr, page = 1, perPage = 8) {
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * perPage;
  return { page: p, perPage, total, pages, data: arr.slice(start, start + perPage) };
}

// Helper: normalize timestamp to Moment (supports seconds or milliseconds)
function toMomentFromTimestamp(ts) {
  // If timestamp is in ms (>= 1e12) convert to seconds
  if (ts > 1e12) {
    return moment.unix(Math.floor(ts / 1000));
  }
  // If looks like seconds
  return moment.unix(Math.floor(ts));
}

// Home / list view
router.get('/', async (req, res) => {
  await fetchProtocols();
  let { page = 1, sort = 'tvl', order = 'desc', category = 'all', search = '' } = req.query;
  page = parseInt(page, 10) || 1;
  order = order === 'asc' ? 'asc' : 'desc';

  let list = protocols.slice();

  if (category && category !== 'all') {
    list = list.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(p => (p.name || '').toLowerCase().includes(q) || ((p.slug || '').toLowerCase().includes(q)));
  }

  if (sort === 'tvl') {
    list.sort((a, b) => order === 'asc' ? a.tvl - b.tvl : b.tvl - a.tvl);
  } else if (sort === 'change_7d') {
    list.sort((a, b) => order === 'asc' ? a.change_7d - b.change_7d : b.change_7d - a.change_7d);
  } else {
    // default
    list.sort((a, b) => b.tvl - a.tvl);
  }

  // Categories for filter
  const categories = Array.from(new Set(protocols.map(p => p.category || 'Unknown'))).sort();

  const pg = paginate(list, page, 8);
  res.render('list', {
    projects: pg.data,
    page: pg.page,
    pages: pg.pages,
    total: pg.total,
    perPage: pg.perPage,
    sort,
    order,
    categories,
    currentCategory: category,
    searchQuery: search
  });
});

// Refresh endpoint (refetch protocols)
router.get('/refresh', async (req, res) => {
  await fetchProtocols(true);
  const redirectTo = req.query.redirect || '/';
  res.redirect(redirectTo);
});

// Project details
router.get('/project/:slug', async (req, res) => {
  await fetchProtocols();
  const slug = req.params.slug;
  const project = protocols.find(p => (p.slug === slug) || (p.id === slug));
  if (!project) {
    return res.status(404).send('Project not found');
  }
  res.render('detail', {
    project,
    period: req.query.period || '30d',
    compareList: [],
    chartUrl: null
  });
});

// Get TVL history for a project and return QuickChart URL
// query params: period = 7d|30d|90d|1y
router.get('/project/:slug/chart', async (req, res) => {
  const slug = req.params.slug;
  const period = req.query.period || '30d';
  const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  const days = daysMap[period] || 30;

  try {
    const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
    const info = await r.json();

    const arr = (info.tvl || []).slice(-days); // take last N points (usually daily)
    if (!arr.length) {
      return res.status(404).json({ error: 'No TVL history available' });
    }

    const labels = arr.map(p => toMomentFromTimestamp(p.date).format('YYYY-MM-DD'));
    const data = arr.map(p => {
      if (typeof p.totalLiquidityUSD === 'number') return p.totalLiquidityUSD;
      if (Array.isArray(p) && p.length >= 2) return p[1];
      return 0;
    });

    const chartConfig = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${info.name || slug} TVL (USD)`,
          data,
          fill: false,
          borderColor: 'rgba(75,192,192,1)'
        }]
      },
      options: {
        title: { display: true, text: `${info.name || slug} — TVL ${period}` },
        scales: {
          yAxes: [{ ticks: { beginAtZero: true } }]
        }
      }
    };

    const qcUrl = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chartConfig));
    res.json({ chartUrl: qcUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not fetch chart data' });
  }
});

// Compare multiple projects (POST form with slugs comma separated)
router.post('/compare', async (req, res) => {
  const { slugs = '', period = '30d' } = req.body;
  const slugsArr = String(slugs).split(',').map(s => s.trim()).filter(Boolean);
  const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  const days = daysMap[period] || 30;

  try {
    const datasets = [];
    let labels = null;

    for (const slug of slugsArr) {
      const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
      const info = await r.json();
      const arr = (info.tvl || []).slice(-days);
      const l = arr.map(p => toMomentFromTimestamp(p.date).format('YYYY-MM-DD'));
      const d = arr.map(p => {
        if (typeof p.totalLiquidityUSD === 'number') return p.totalLiquidityUSD;
        if (Array.isArray(p) && p.length >= 2) return p[1];
        return 0;
      });

      if (!labels || l.length > labels.length) labels = l;
      datasets.push({ label: info.name || slug, data: d, fill: false, borderColor: getRandomColor() });
    }

    const chartConfig = {
      type: 'line',
      data: { labels, datasets },
      options: { title: { display: true, text: `Compare — ${period}` } }
    };
    const qcUrl = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chartConfig));
    res.json({ chartUrl: qcUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Compare failed' });
  }
});

// Helper to get random rgba color
function getRandomColor() {
  const r = Math.floor(Math.random() * 200) + 20;
  const g = Math.floor(Math.random() * 200) + 20;
  const b = Math.floor(Math.random() * 200) + 20;
  return `rgba(${r},${g},${b},1)`;
}

module.exports = router;
