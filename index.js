const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hodín

let cache = { movies: [], tv: [], lastFetch: 0 };

const MANIFEST = {
  id: 'community.netflix-cz-catalog',
  version: '1.0.0',
  name: 'Netflix CZ',
  description: 'Filmy a seriály dostupné na Netflixe v Česku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie',  id: 'netflix-cz-movies',  name: 'Netflix CZ – Filmy',   extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'netflix-cz-series',  name: 'Netflix CZ – Seriály', extra: [{ name: 'skip', isRequired: false }] },
  ],
  idPrefixes: ['tmdb:'],
  behaviorHints: { configurable: false, configurationRequired: false }
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

async function fetchPage(type, page) {
  const sort = 'popularity.desc';
  const url = type === 'movie'
    ? `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_watch_providers=8&watch_region=CZ&sort_by=${sort}&page=${page}&language=cs-CZ&include_adult=false`
    : `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}&with_watch_providers=8&watch_region=CZ&sort_by=${sort}&page=${page}&language=cs-CZ&include_adult=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB error ${r.status}`);
  return r.json();
}

function toStremioItem(item, type) {
  return {
    id: `tmdb:${item.id}`,
    type: type === 'movie' ? 'movie' : 'series',
    name: item.title || item.name || item.original_title || item.original_name || '',
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
    description: item.overview || '',
    releaseInfo: (item.release_date || item.first_air_date || '').substring(0, 4),
    imdbRating: item.vote_average ? String(item.vote_average.toFixed(1)) : undefined,
    genres: [],
  };
}

async function refreshCache() {
  if (!TMDB_KEY) { console.error('Chýba TMDB_API_KEY!'); return; }
  if (Date.now() - cache.lastFetch < CACHE_TTL) return;

  console.log('Obnova cache...');
  try {
    const movies = [];
    const tv = [];
    for (let p = 1; p <= 10; p++) {
      const d = await fetchPage('movie', p);
      movies.push(...(d.results || []));
      if (p >= d.total_pages) break;
      await new Promise(r => setTimeout(r, 100));
    }
    for (let p = 1; p <= 10; p++) {
      const d = await fetchPage('tv', p);
      tv.push(...(d.results || []));
      if (p >= d.total_pages) break;
      await new Promise(r => setTimeout(r, 100));
    }
    cache = { movies, tv, lastFetch: Date.now() };
    console.log(`Cache: ${movies.length} filmov, ${tv.length} seriálov`);
  } catch (e) {
    console.error('Chyba pri obnove cache:', e.message);
  }
}

// Manifest
app.get('/manifest.json', (req, res) => {
  res.json(MANIFEST);
});

// Catalog
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    await refreshCache();
    const { type, id } = req.params;
    const skip = parseInt(req.query.skip || '0');
    const PAGE_SIZE = 20;

    let items = [];
    if (id === 'netflix-cz-movies' && type === 'movie') {
      items = cache.movies.map(m => toStremioItem(m, 'movie'));
    } else if (id === 'netflix-cz-series' && type === 'series') {
      items = cache.tv.map(m => toStremioItem(m, 'tv'));
    }

    const page = items.slice(skip, skip + PAGE_SIZE);
    res.json({ metas: page });
  } catch (e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send(`Netflix CZ Addon beží ✓ | Filmy: ${cache.movies.length} | Seriály: ${cache.tv.length} | Cache: ${cache.lastFetch ? new Date(cache.lastFetch).toLocaleString('sk-SK') : 'ešte nenahrané'}`);
});

app.listen(PORT, () => {
  console.log(`Server beží na porte ${PORT}`);
  refreshCache();
});
