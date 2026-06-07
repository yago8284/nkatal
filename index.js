const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// HBO Max v CZ má TMDB provider ID 1843 (Max/HBO Max Europe)
// 384 je HBO Max USA, nefunguje pre CZ
const PROVIDERS = [
  { id: 8,    name: 'Netflix',     slug: 'netflix' },
  { id: 337,  name: 'Disney+',     slug: 'disney'  },
  { id: 119,  name: 'Prime Video', slug: 'prime'   },
  { id: 1899, name: 'HBO Max',     slug: 'hbo'     },
];

const MOVIE_GENRES = [28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37];
const TV_GENRES   = [10759,16,35,80,99,18,10751,10762,9648,10763,10764,878,10765,10766,10767,10768,37];

let cache = {};
PROVIDERS.forEach(p => { cache[p.slug] = { movies: [], tv: [], lastFetch: 0, building: false }; });

const MANIFEST = {
  id: 'community.cz-streaming-catalogs',
  version: '3.1.0',
  name: 'CZ Streaming Katalógy',
  description: 'Netflix, Disney+, Prime Video a HBO Max – obsah dostupný v Česku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: PROVIDERS.flatMap(p => [
    { type: 'movie',  id: `${p.slug}-cz-movies`,  name: `${p.name} CZ – Filmy`,   extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: `${p.slug}-cz-series`,  name: `${p.name} CZ – Seriály`, extra: [{ name: 'skip', isRequired: false }] },
  ]),
  idPrefixes: ['tmdb:'],
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

async function fetchGenre(mediaType, providerId, genreId, maxPages = 5) {
  const base = `/discover/${mediaType}?with_watch_providers=${providerId}&watch_region=CZ&language=cs-CZ&include_adult=false${genreId ? '&with_genres='+genreId : ''}&sort_by=popularity.desc`;
  const results = [];
  for (let p = 1; p <= maxPages; p++) {
    try {
      const d = await tmdbGet(`${base}&page=${p}`);
      results.push(...(d.results || []));
      if (p >= (d.total_pages || 1)) break;
      await new Promise(r => setTimeout(r, 100));
    } catch(e) { break; }
  }
  return results;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
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

let buildPromises = {};

async function buildProviderCache(provider) {
  const c = cache[provider.slug];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log(`[${provider.name}] Budovanie cache (provider ID: ${provider.id})...`);
  try {
    const [movieBatches, tvBatches] = await Promise.all([
      Promise.all([
        fetchGenre('movie', provider.id, null, 20),
        ...MOVIE_GENRES.map(g => fetchGenre('movie', provider.id, g, 5))
      ]),
      Promise.all([
        fetchGenre('tv', provider.id, null, 20),
        ...TV_GENRES.map(g => fetchGenre('tv', provider.id, g, 5))
      ])
    ]);

    const movies = dedup(movieBatches.flat());
    movies.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    const tv = dedup(tvBatches.flat());
    tv.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    cache[provider.slug] = { movies, tv, lastFetch: Date.now(), building: false };
    console.log(`[${provider.name}] Hotovo: ${movies.length} filmov, ${tv.length} seriálov`);
  } catch(e) {
    c.building = false;
    console.error(`[${provider.name}] Chyba:`, e.message);
  }
}

async function ensureProviderCache(provider) {
  const c = cache[provider.slug];
  if (c.movies.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[provider.slug]) {
    buildPromises[provider.slug] = buildProviderCache(provider).finally(() => {
      delete buildPromises[provider.slug];
    });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(r => setTimeout(r, 120000))]);
}

app.get('/manifest.json', (req, res) => res.json(MANIFEST));

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  try {
    const { type, id, extra } = req.params;
    const provider = PROVIDERS.find(p => id.startsWith(p.slug));
    if (!provider) return res.json({ metas: [] });

    await ensureProviderCache(provider);

    let skip = 0;
    if (extra) { const m = extra.match(/skip=(\d+)/); if (m) skip = parseInt(m[1]); }
    if (req.query.skip) skip = parseInt(req.query.skip);

    const PAGE_SIZE = 20;
    const c = cache[provider.slug];
    let items = [];

    if (id === `${provider.slug}-cz-movies` && type === 'movie') {
      items = c.movies.map(m => toStremioItem(m, 'movie'));
    } else if (id === `${provider.slug}-cz-series` && type === 'series') {
      items = c.tv.map(m => toStremioItem(m, 'tv'));
    }

    console.log(`[catalog] ${id} skip=${skip} → ${Math.min(PAGE_SIZE, items.length-skip)} z ${items.length}`);
    res.json({ metas: items.slice(skip, skip + PAGE_SIZE) });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

// Diagnostika — zoznam všetkých providerov v CZ
app.get('/providers', async (req, res) => {
  try {
    const r = await fetch(`https://api.themoviedb.org/3/watch/providers/movie?api_key=${TMDB_KEY}&watch_region=CZ&language=cs-CZ`);
    const d = await r.json();
    const list = (d.results || []).map(p => `${String(p.provider_id).padStart(5)}  ${p.provider_name}`).join('\n');
    res.send(`<pre>Provideri dostupní v CZ:\n\n${list}</pre>`);
  } catch(e) {
    res.send('Chyba: ' + e.message);
  }
});

app.get('/', (req, res) => {
  const rows = PROVIDERS.map(p => {
    const c = cache[p.slug];
    const age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nenahrané';
    return `${p.name.padEnd(14)} Filmy: ${String(c.movies.length).padStart(4)}  Seriály: ${String(c.tv.length).padStart(4)}  Cache: ${age}`;
  }).join('\n');
  res.send(`<pre>CZ Streaming Katalógy v3.1\n\n${rows}\n\n<a href="/manifest.json">/manifest.json</a>\n<a href="/providers">/providers (zoznam CZ providerov)</a></pre>`);
});

app.listen(PORT, () => {
  console.log(`Server štartuje na porte ${PORT}`);
  (async () => {
    for (const p of PROVIDERS) {
      await buildProviderCache(p);
    }
  })();
});
