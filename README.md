{
  "name": "base-tvl-frame",
  "version": "1.0.0",
  "description": "Mini-app for Farcaster (C-Max PRO) showing Base projects TVL",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "author": "Mirlan1",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "ejs": "^3.1.9",
    "node-fetch": "^2.6.7",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "moment": "^2.29.4"
  },
  "engines": {
    "node": ">=14"
  }
}const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const routes = require('./app/frame/route');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', routes);

app.listen(PORT, () => {
  console.log(`Base TVL mini-app listening on port ${PORT}`);
});Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
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
    const baseOnly = all.filter(p => Array.isArray(p.chains) && p.chains.includes('Base'))
      .map(p => ({
        id: p.id || p.slug || p.name,
        name: p.name,
        slug: p.slug || (p.name && p.name.toLowerCase().replace(/\s+/g, '-')),
        tvl: p.tvl || p.tvl || 0,
        change_7d: p.change_7d || p.change_30d || 0,
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

// Utility: paginate
function paginate(arr, page = 1, perPage = 8) {
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * perPage;
  return {
    page: p,
    perPage,
    total,
    pages,
    data: arr.slice(start, start + perPage)
  };
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
    list = list.filter(p => p.name.toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q));
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
  // 7d change and other quick info available in project object
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
    // info.tvl - array of {date, totalLiquidityUSD}
    const series = (info.tvl || []).slice(-days * 24); // defensive: if API returns hourly/daily try to take last N points; we'll just take last 'days' points
    // However Llama returns daily points — we will take last `days` entries
    const arr = (info.tvl || []).slice(-days);
    const labels = arr.map(p => moment.unix(Math.floor(p.date / 1000)).format('YYYY-MM-DD'));
    const data = arr.map(p => p.totalLiquidityUSD || p.totalLiquidityUSD === 0 ? p.totalLiquidityUSD : p[1] || 0);

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
  const slugsArr = slugs.split(',').map(s => s.trim()).filter(Boolean);
  const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  const days = daysMap[period] || 30;
  try {
    const datasets = [];
    let labels = null;
    for (const slug of slugsArr) {
      const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
      const info = await r.json();
      const arr = (info.tvl || []).slice(-days);
      const l = arr.map(p => moment.unix(Math.floor(p.date / 1000)).format('YYYY-MM-DD'));
      const d = arr.map(p => p.totalLiquidityUSD || p[1] || 0);
      if (!labels || l.length > labels.length) labels = l;
      datasets.push({
        label: info.name || slug,
        data: d,
        fill: false,
        borderColor: getRandomColor()
      });
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

module.exports = router;<% include('layout', { body: '' }) %>
<% // We render content into layout by overriding body variable %>
<% body = (function(){ %>
  <div class="controls">
    <form method="get" action="/">
      <label>Category:
        <select name="category" onchange="this.form.submit()">
          <option value="all" <%= currentCategory === 'all' ? 'selected' : '' %>>All</option>
          <% categories.forEach(c=>{ %>
            <option value="<%= c %>" <%= currentCategory === c ? 'selected' : '' %>><%= c %></option>
          <% }) %>
        </select>
      </label>
      <label>Sort:
        <select name="sort" onchange="this.form.submit()">
          <option value="tvl" <%= sort==='tvl' ? 'selected' : '' %>>TVL</option>
          <option value="change_7d" <%= sort==='change_7d' ? 'selected' : '' %>>7d change</option>
        </select>
      </label>
      <label>Order:
        <select name="order" onchange="this.form.submit()">
          <option value="desc" <%= order==='desc' ? 'selected' : '' %>>Desc</option>
          <option value="asc" <%= order==='asc' ? 'selected' : '' %>>Asc</option>
        </select>
      </label>
    </form>
  </div>

  <div class="list">
    <% projects.forEach(p => { %>
      <div class="project-card">
        <div class="left">
          <% if (p.logo) { %>
            <img src="<%= p.logo %>" alt="<%= p.name %>" width="48" height="48"/>
          <% } %>
        </div>
        <div class="right">
          <h3><a href="/project/<%= p.slug %>"><%= p.name %></a></h3>
          <p>TVL: $<%= Number(p.tvl || 0).toLocaleString() %> • 7d: <%= (p.change_7d || 0).toFixed(2) %>% • Category: <%= p.category %></p>
        </div>
      </div>
    <% }) %>
  </div>

  <div class="pagination">
    <% if (page > 1) { %>
      <a href="/?page=<%= page-1 %>&sort=<%= sort %>&order=<%= order %>&category=<%= currentCategory %>&search=<%= searchQuery %>">Prev</a>
    <% } %>
    <span>Page <%= page %> / <%= pages %> (total <%= total %>)</span>
    <% if (page < pages) { %>
      <a href="/?page=<%= page+1 %>&sort=<%= sort %>&order=<%= order %>&category=<%= currentCategory %>&search=<%= searchQuery %>">Next</a>
    <% } %>
  </div>
<% return ''; })() %><% include('layout', { body: '' }) %>
<% body = (function(){ %>
  <div class="detail-header">
    <h2><%= project.name %></h2>
    <p>TVL: $<%= Number(project.tvl || 0).toLocaleString() %> • 7d change: <%= (project.change_7d || 0).toFixed(2) %>%</p>
    <div class="actions">
      <a href="/project/<%= project.slug %>">Tokens</a>
      <button onclick="loadChart('<%= project.slug %>', '30d')">Chart (30d)</button>
      <button onclick="loadChart('<%= project.slug %>', '7d')">7d change</button>
      <a href="/refresh?redirect=/project/<%= project.slug %>"><button>Refresh</button></a>
      <a href="/"><button>Back to list</button></a>
    </div>
  </div>

  <div id="tokens">
    <h3>Tokens</h3>
    <% if (project.tokens && project.tokens.length) { %>
      <ul>
        <% project.tokens.forEach(t => { %>
          <li><%= t.symbol || t.address || t %> <% if (t.address) { %> - <%= t.address %> <% } %></li>
        <% }) %>
      </ul>
    <% } else { %>
      <p>No tokens metadata available.</p>
    <% } %>
  </div>

  <div id="chart">
    <h3>TVL Chart</h3>
    <div>
      <label>Period:
        <select id="periodSelect" onchange="loadChart('<%= project.slug %>', this.value)">
          <option value="7d">7d</option>
          <option value="30d" selected>30d</option>
          <option value="90d">90d</option>
          <option value="1y">1y</option>
        </select>
      </label>
    </div>
    <div id="chartImage">
      <!-- Chart will be loaded here -->
    </div>
    <script>
      async function loadChart(slug, period) {
        document.getElementById('chartImage').innerHTML = 'Loading...';
        const res = await fetch(`/project/${slug}/chart?period=${period}`);
        if (res.ok) {
          const js = await res.json();
          document.getElementById('chartImage').innerHTML = '<img src="' + js.chartUrl + '" alt="chart" style="max-width:100%"/>';
        } else {
          document.getElementById('chartImage').innerHTML = 'Chart load failed';
        }
      }
    </script>
  </div>

  <div id="compare">
    <h3>Compare projects</h3>
    <form id="compareForm" onsubmit="return doCompare(event)">
      <input name="slugs" id="compareInput" placeholder="Enter slugs separated by comma, e.g. protocol-a,protocol-b" />
      <select id="comparePeriod" name="period">
        <option value="7d">7d</option>
        <option value="30d" selected>30d</option>
        <option value="90d">90d</option>
        <option value="1y">1y</option>
      </select>
      <button type="submit">Compare</button>
    </form>
    <div id="compareChart"></div>

    <script>
      async function doCompare(e) {
        e.preventDefault();
        const slugs = document.getElementById('compareInput').value;
        const period = document.getElementById('comparePeriod').value;
        document.getElementById('compareChart').innerHTML = 'Loading...';
        const res = await fetch('/compare', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ slugs, period })
        });
        if (res.ok) {
          const js = await res.json();
          document.getElementById('compareChart').innerHTML = '<img src="' + js.chartUrl + '" alt="compare chart" style="max-width:100%"/>';
        } else {
          document.getElementById('compareChart').innerHTML = 'Compare failed';
        }
        return false;
      }
    </script>
  </div>
<% return ''; })() %>body { font-family: Arial, sans-serif; margin: 0; padding: 0; background:#f6f8fa; color:#111; }
.container { max-width: 980px; margin: 0 auto; padding: 16px; }
header { display:flex; justify-content:space-between; align-items:center; }
header h1 { margin:0; font-size:20px; }
.search-form input { padding:6px; }
.list { margin-top:16px; display:flex; flex-direction:column; gap:8px; }
.project-card { display:flex; padding:10px; background:white; border-radius:6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.project-card img { border-radius:4px; margin-right:12px; }
.project-card h3 { margin:0; }
.pagination { margin-top:12px; display:flex; gap:10px; align-items:center; }
.detail-header { background:white; padding:12px; border-radius:6px; margin-top:12px; }
.actions button, .actions a button { margin-right:6px; }
.controls { margin-top:12px; }
footer { margin-top:24px; font-size:12px; color:#666; } 
