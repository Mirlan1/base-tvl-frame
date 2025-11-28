const express = require('express');
const fetch = require('node-fetch').default;
const app = express();

app.set('view engine', 'ejs');
app.set('views', './views');

app.get('/', (req, res) => res.render('index'));

app.get('/og', async (req, res) => {
  try {
    const data = await fetch('https://api.llama.fi/v2/chains').then(r => r.json());
    const base = data.find(c => c.name.toLowerCase() === 'base');
    const tvl = base ? (base.tvl / 1e9).toFixed(2) : '?.??';

    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#000814"/>
      <defs><linearGradient id="g"><stop offset="0%" stop-color="#0052FF"/><stop offset="100%" stop-color="#00D1FF"/></linearGradient></defs>
      <rect width="1200" height="630" fill="url(#g)"/>
      <text x="100" y="280" font-family="Arial, sans-serif" font-size="100" fill="white">Base TVL</text>
      <text x="100" y="460" font-family="Arial, sans-serif" font-size="200" fill="white" font-weight="bold">$${tvl}B</text>
      <text x="100" y="560" font-family="Arial, sans-serif" font-size="60" fill="#aaa">Live data from Llama.fi</text>
    </svg>`;

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.send(svg);
  } catch (e) { res.status(500).send('Error'); }
});

app.post('/refresh', (req, res) => res.redirect('/'));

module.exports = app;
