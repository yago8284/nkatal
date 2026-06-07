const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

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
  version: '3.2.0',
  name: 'CZ Streaming Katalogy',
  description: 'Netflix, Disney+, Prime Video a HBO Max v Česku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: PROVIDERS.flatMap(p => [
    { type: 'movie',  id: p.slug + '-cz-movies', name: p.name + ' CZ - Filmy',   extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: p.slug + '-cz-series', name: p.name + ' CZ - Serialy', extra: [{ name: 'skip', isRequired: false }] },
  ]),
  idPrefixes: ['tmdb:'],
};

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbGet(path) {
  var sep = path.includes('?') ? '&' : '?';
  var r = await fetch('https://api.themoviedb.org/3' + path + sep + 'api_key=' + TMDB_KEY);
  if (!r.ok) throw new Error('TMDB ' + r.status + ': ' + path);
  return r.json();
}

async function fetchGenre(mediaType, providerId, genreId, maxPages) {
  maxPages = maxPages || 5;
  var base = '/discover/' + mediaType + '?with_watch_providers=' + providerId + '&watch_region=CZ&language=cs-CZ&include_adult=false' + (genreId ? '&with_genres=' + genreId : '') + '&sort_by=popularity.desc';
  var results = [];
  for (var p = 1; p <= maxPages; p++) {
    try {
      var d = await tmdbGet(base + '&page=' + p);
      results = results.concat(d.results || []);
      if (p >= (d.total_pages || 1)) break;
      await new Promise(function(r) { setTimeout(r, 100); });
    } catch(e) { break; }
  }
  return results;
}

function dedup(arr) {
  var seen = {};
  return arr.filter(function(item) {
    if (!item || !item.id || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });
}

function toItem(item, type) {
  return {
    id: 'tmdb:' + item.id,
    type: type === 'movie' ? 'movie' : 'series',
    name: item.title || item.name || item.original_title || item.original_name || '',
    poster: item.poster_path ? 'https://image.tmdb.org/t/p/w500' + item.poster_path : undefined,
    background: item.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + item.backdrop_path : undefined,
    description: item.overview || '',
    releaseInfo: (item.release_date || item.first_air_date || '').substring(0, 4),
    imdbRating: item.vote_average ? String(item.vote_average.toFixed(1)) : undefined,
  };
}

var buildPromises = {};

async function buildCache(provider) {
  var c = cache[provider.slug];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + provider.name + '] Budovanie cache...');
  try {
    var mg = [fetchGenre('movie', provider.id, null, 20)].concat(MOVIE_GENRES.map(function(g) { return fetchGenre('movie', provider.id, g, 5); }));
    var tg = [fetchGenre('tv', provider.id, null, 20)].concat(TV_GENRES.map(function(g) { return fetchGenre('tv', provider.id, g, 5); }));
    var results = await Promise.all([Promise.all(mg), Promise.all(tg)]);
    var movies = dedup(results[0].reduce(function(a, b) { return a.concat(b); }, []));
    var tv = dedup(results[1].reduce(function(a, b) { return a.concat(b); }, []));
    movies.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    tv.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    cache[provider.slug] = { movies: movies, tv: tv, lastFetch: Date.now(), building: false };
    console.log('[' + provider.name + '] Hotovo: ' + movies.length + ' filmov, ' + tv.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + provider.name + '] Chyba: ' + e.message);
  }
}

async function ensureCache(provider) {
  var c = cache[provider.slug];
  if (c.movies.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[provider.slug]) {
    buildPromises[provider.slug] = buildCache(provider).finally(function() { delete buildPromises[provider.slug]; });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(function(r) { setTimeout(r, 120000); })]);
}

app.get('/manifest.json', function(req, res) { res.json(MANIFEST); });

app.get('/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extra = req.params.extra;
    var provider = null;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (id.startsWith(PROVIDERS[i].slug)) { provider = PROVIDERS[i]; break; }
    }
    if (!provider) return res.json({ metas: [] });
    await ensureCache(provider);
    var skip = 0;
    if (extra) { var m = extra.match(/skip=(\d+)/); if (m) skip = parseInt(m[1]); }
    if (req.query.skip) skip = parseInt(req.query.skip);
    var PAGE_SIZE = 20;
    var c = cache[provider.slug];
    var items = [];
    if (id === provider.slug + '-cz-movies' && type === 'movie') {
      items = c.movies.map(function(m) { return toItem(m, 'movie'); });
    } else if (id === provider.slug + '-cz-series' && type === 'series') {
      items = c.tv.map(function(m) { return toItem(m, 'tv'); });
    }
    console.log('[catalog] ' + id + ' skip=' + skip + ' -> ' + Math.min(PAGE_SIZE, items.length - skip) + ' z ' + items.length);
    res.json({ metas: items.slice(skip, skip + PAGE_SIZE) });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/', function(req, res) {
  var rows = PROVIDERS.map(function(p) {
    var c = cache[p.slug];
    var age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nahrava sa';
    return p.name + ' Filmy: ' + c.movies.length + ' Serialy: ' + c.tv.length + ' Cache: ' + age;
  }).join('\n');
  res.send('<pre>CZ Streaming Katalogy v3.2\n\n' + rows + '\n\n<a href="/manifest.json">/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server na porte ' + PORT);
  (async function() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      await buildCache(PROVIDERS[i]);
    }
  })();
});
