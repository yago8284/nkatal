const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { movies: [], tv: [], lastFetch: 0, building: false };

const MANIFEST = {
  id: 'community.netflix-cz-catalog',
  version: '1.2.0',
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
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

async function fetchAllPages(basePath, maxPages = 20) {
  const results = [];
  for (let p = 1; p <= maxPages; p++) {
    const sep = basePath.includes('?') ? '&' : '?';
    try {
      const d = await tmdbGet(`${basePath}${sep}page=${p}`);
      const batch = d.results || [];
      results.push(...batch);
      console.log(`  ${basePath.substring(0,50)}... strana ${p}/${Math.min(maxPages, d.total_pages||1)} (${batch.length} položiek)`);
      if (p >= (d.total_pages || 1)) break;
      await new Promise(r => setTimeout(r, 150));
    } catch(e) {
      console.error(`  Chyba na strane ${p}:`, e.message);
      break;
    }
  }
  return results;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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
  };
}

// Vráti promise ktorý sa vyrieši keď je cache plná
let cachePromise = null;

async function buildCache() {
  if (!TMDB_KEY) { console.error('CHÝBA TMDB_API_KEY'); return; }
  if (cache.building) return;
  if (Date.now() - cache.lastFetch < CACHE_TTL) return;

  cache.building = true;
  console.log('\n=== BUDOVANIE CACHE ===');

  try {
    const base_m = `/discover/movie?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false`;
    const base_tv = `/discover/tv?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false`;

    console.log('--- FILMY ---');
    const [mPop, mRated, mNew, mVotes] = await Promise.all([
      fetchAllPages(`${base_m}&sort_by=popularity.desc`, 20),
      fetchAllPages(`${base_m}&sort_by=vote_average.desc&vote_count.gte=50`, 15),
      fetchAllPages(`${base_m}&sort_by=primary_release_date.desc`, 10),
      fetchAllPages(`${base_m}&sort_by=vote_count.desc`, 15),
    ]);

    console.log('--- NETFLIX ORIGINÁLY (filmy) ---');
    const mOrig = await fetchAllPages(
      `/discover/movie?with_keywords=180547&language=cs-CZ&sort_by=popularity.desc`, 10
    );

    const allMovies = dedup([...mPop, ...mRated, ...mNew, ...mVotes, ...mOrig]);
    allMovies.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    console.log(`Filmy celkom: ${allMovies.length}`);

    console.log('--- SERIÁLY ---');
    const [tvPop, tvRated, tvNew, tvVotes] = await Promise.all([
      fetchAllPages(`${base_tv}&sort_by=popularity.desc`, 20),
      fetchAllPages(`${base_tv}&sort_by=vote_average.desc&vote_count.gte=50`, 15),
      fetchAllPages(`${base_tv}&sort_by=first_air_date.desc`, 10),
      fetchAllPages(`${base_tv}&sort_by=vote_count.desc`, 15),
    ]);

    console.log('--- NETFLIX ORIGINÁLY (seriály) ---');
    const tvOrig = await fetchAllPages(
      `/discover/tv?with_keywords=180547&language=cs-CZ&sort_by=popularity.desc`, 10
    );

    const allTv = dedup([...tvPop, ...tvRated, ...tvNew, ...tvVotes, ...tvOrig]);
    allTv.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    console.log(`Seriály celkom: ${allTv.length}`);

    cache = { movies: allMovies, tv: allTv, lastFetch: Date.now(), building: false };
    console.log('=== CACHE HOTOVÁ ===\n');

  } catch (e) {
    cache.building = false;
    console.error('Chyba buildCache:', e.message);
  }
}

// Čaká kým je cache plná (alebo timeout 90s)
async function ensureCache() {
  if (cache.movies.length > 0 && Date.now() - cache.lastFetch < CACHE_TTL) return;
  if (!cachePromise) {
    cachePromise = buildCache().finally(() => { cachePromise = null; });
  }
  // Počkaj max 90 sekúnd
  await Promise.race([
    cachePromise,
    new Promise(r => setTimeout(r, 90000))
  ]);
}

app.get('/manifest.json', (req, res) => res.json(MANIFEST));

app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    await ensureCache();
    const { type, id } = req.params;
    const skip = parseInt(req.query.skip || '0');
    const PAGE_SIZE = 20;

    let items = [];
    if (id === 'netflix-cz-movies' && type === 'movie') {
      items = cache.movies.map(m => toStremioItem(m, 'movie'));
    } else if (id === 'netflix-cz-series' && type === 'series') {
      items = cache.tv.map(m => toStremioItem(m, 'tv'));
    }

    console.log(`Catalog ${id}: skip=${skip}, vrátim ${Math.min(PAGE_SIZE, items.length - skip)} z ${items.length}`);
    res.json({ metas: items.slice(skip, skip + PAGE_SIZE) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/', (req, res) => {
  const age = cache.lastFetch
    ? Math.round((Date.now() - cache.lastFetch) / 60000) + ' min'
    : 'ešte nenahrané';
  res.send(
    `<pre>Netflix CZ Addon v1.2\n` +
    `Filmy:   ${cache.movies.length}\n` +
    `Seriály: ${cache.tv.length}\n` +
    `Cache:   ${age} stará\n` +
    `Building: ${cache.building}\n\n` +
    `Manifest: /manifest.json</pre>`
  );
});

// Predohrej cache hneď pri štarte — nečakaj na prvý request
app.listen(PORT, () => {
  console.log(`Server štartuje na porte ${PORT}`);
  buildCache();
});
