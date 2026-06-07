const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// ── STREAMING PROVIDERI ──────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 8,    name: 'Netflix',     slug: 'netflix' },
  { id: 337,  name: 'Disney+',     slug: 'disney'  },
  { id: 119,  name: 'Prime Video', slug: 'prime'   },
  { id: 1899, name: 'HBO Max',     slug: 'hbo'     },
];

// ── ŽÁNRE ────────────────────────────────────────────────────────────────────
const MOVIE_GENRES = [
  { id: 28,    name: 'Akcia'         },
  { id: 12,    name: 'Dobrodružstvo' },
  { id: 16,    name: 'Animácia'      },
  { id: 35,    name: 'Komédia'       },
  { id: 80,    name: 'Krimi'         },
  { id: 99,    name: 'Dokumentárny'  },
  { id: 18,    name: 'Dráma'         },
  { id: 10751, name: 'Rodinný'       },
  { id: 14,    name: 'Fantasy'       },
  { id: 27,    name: 'Horor'         },
  { id: 9648,  name: 'Mysteriózny'   },
  { id: 10749, name: 'Romantický'    },
  { id: 878,   name: 'Sci-Fi'        },
  { id: 53,    name: 'Thriller'      },
  { id: 10752, name: 'Vojnový'       },
  { id: 37,    name: 'Western'       },
];

const TV_GENRES = [
  { id: 10759, name: 'Akcia'          },
  { id: 16,    name: 'Animácia'       },
  { id: 35,    name: 'Komédia'        },
  { id: 80,    name: 'Krimi'          },
  { id: 99,    name: 'Dokumentárny'   },
  { id: 18,    name: 'Dráma'          },
  { id: 10751, name: 'Rodinný'        },
  { id: 9648,  name: 'Mysteriózny'    },
  { id: 878,   name: 'Sci-Fi'         },
  { id: 10765, name: 'Sci-Fi/Fantasy' },
  { id: 53,    name: 'Thriller'       },
];

const MOVIE_GENRE_IDS = MOVIE_GENRES.map(function(g) { return g.id; });
const TV_GENRE_IDS    = TV_GENRES.map(function(g) { return g.id; });

// ── CACHE ────────────────────────────────────────────────────────────────────
let providerCache = {};
PROVIDERS.forEach(function(p) {
  providerCache[p.slug] = { movies: [], tv: [], lastFetch: 0, building: false };
});

// ── MANIFEST 1: Streaming katalógy ──────────────────────────────────────────
const STREAMING_MANIFEST = {
  id: 'community.cz-streaming-catalogs',
  version: '5.1.0',
  name: 'CZ Streaming Katalogy',
  description: 'Netflix, Disney+, Prime Video, HBO Max v Česku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: PROVIDERS.flatMap(function(p) {
    return [
      { type: 'movie',  id: p.slug + '-cz-movies', name: p.name + ' CZ - Filmy',   extra: [{ name: 'skip', isRequired: false }] },
      { type: 'series', id: p.slug + '-cz-series', name: p.name + ' CZ - Serialy', extra: [{ name: 'skip', isRequired: false }] },
    ];
  }),
  idPrefixes: ['tmdb:'],
};

// ── MANIFEST 2: Žánrový katalóg ──────────────────────────────────────────────
const GENRE_MANIFEST = {
  id: 'community.cz-genre-catalog',
  version: '1.0.0',
  name: 'CZ Katalóg podľa žánru',
  description: 'Všetky filmy a seriály zo všetkých streamovacích služieb podľa žánru',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [].concat(
    MOVIE_GENRES.map(function(g) {
      return { type: 'movie', id: 'genre-movie-' + g.id, name: '🎬 ' + g.name, extra: [{ name: 'skip', isRequired: false }] };
    }),
    TV_GENRES.map(function(g) {
      return { type: 'series', id: 'genre-tv-' + g.id, name: '📺 ' + g.name, extra: [{ name: 'skip', isRequired: false }] };
    }),
    [
      { type: 'movie',  id: 'genre-movie-top',  name: '⭐ Filmy - Top hodnotenie',   extra: [{ name: 'skip', isRequired: false }] },
      { type: 'series', id: 'genre-tv-top',     name: '⭐ Serialy - Top hodnotenie', extra: [{ name: 'skip', isRequired: false }] },
      { type: 'movie',  id: 'genre-movie-new',  name: '🆕 Filmy - Najnovšie',        extra: [{ name: 'skip', isRequired: false }] },
      { type: 'series', id: 'genre-tv-new',     name: '🆕 Serialy - Najnovšie',      extra: [{ name: 'skip', isRequired: false }] },
      { type: 'movie',  id: 'genre-movie-pop',  name: '🔥 Filmy - Najpopulárnejšie', extra: [{ name: 'skip', isRequired: false }] },
      { type: 'series', id: 'genre-tv-pop',     name: '🔥 Serialy - Najpopulárnejšie', extra: [{ name: 'skip', isRequired: false }] },
    ]
  ),
  idPrefixes: ['tmdb:'],
};

// ── EXPRESS ───────────────────────────────────────────────────────────────────
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbFetch(url) {
  var r = await fetch(url);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
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

function parseSkip(extraStr, query) {
  var skip = 0;
  if (extraStr) {
    var m = extraStr.match(/skip=(\d+)/);
    if (m) skip = parseInt(m[1]);
  }
  if (query.skip) skip = parseInt(query.skip);
  return skip;
}

// ── STREAMING CACHE ───────────────────────────────────────────────────────────
async function fetchGenreForCache(mediaType, providerId, genreId, maxPages) {
  maxPages = maxPages || 5;
  var base = 'https://api.themoviedb.org/3/discover/' + mediaType
    + '?api_key=' + TMDB_KEY
    + '&with_watch_providers=' + providerId
    + '&watch_region=CZ&language=cs-CZ&include_adult=false'
    + (genreId ? '&with_genres=' + genreId : '')
    + '&sort_by=popularity.desc';
  var results = [];
  for (var p = 1; p <= maxPages; p++) {
    try {
      var d = await tmdbFetch(base + '&page=' + p);
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

var buildPromises = {};

async function buildProviderCache(provider) {
  var c = providerCache[provider.slug];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + provider.name + '] Budovanie cache...');
  try {
    var mg = [fetchGenreForCache('movie', provider.id, null, 20)].concat(
      MOVIE_GENRE_IDS.map(function(g) { return fetchGenreForCache('movie', provider.id, g, 5); })
    );
    var tg = [fetchGenreForCache('tv', provider.id, null, 20)].concat(
      TV_GENRE_IDS.map(function(g) { return fetchGenreForCache('tv', provider.id, g, 5); })
    );
    var results = await Promise.all([Promise.all(mg), Promise.all(tg)]);
    var movies = dedup(results[0].reduce(function(a, b) { return a.concat(b); }, []));
    var tv = dedup(results[1].reduce(function(a, b) { return a.concat(b); }, []));
    movies.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    tv.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    providerCache[provider.slug] = { movies: movies, tv: tv, lastFetch: Date.now(), building: false };
    console.log('[' + provider.name + '] ' + movies.length + ' filmov, ' + tv.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + provider.name + '] Chyba: ' + e.message);
  }
}

async function ensureProviderCache(provider) {
  var c = providerCache[provider.slug];
  if (c.movies.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[provider.slug]) {
    buildPromises[provider.slug] = buildProviderCache(provider).finally(function() {
      delete buildPromises[provider.slug];
    });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(function(r) { setTimeout(r, 120000); })]);
}

// ── ŽÁNROVÝ FETCH (priamo z TMDB, bez filtra providera) ───────────────────────
async function fetchGenreCatalog(mediaType, params, skip) {
  var page = Math.floor(skip / 20) + 1;
  // Všetky 4 CZ provideri spojené pipe-om
  var allProviders = PROVIDERS.map(function(p) { return p.id; }).join('|');
  var url = 'https://api.themoviedb.org/3/discover/' + mediaType
    + '?api_key=' + TMDB_KEY
    + '&with_watch_providers=' + allProviders
    + '&watch_region=CZ'
    + '&language=cs-CZ'
    + '&include_adult=false'
    + '&' + params
    + '&page=' + page;
  var d = await tmdbFetch(url);
  return (d.results || []).map(function(x) { return toItem(x, mediaType); });
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Streaming manifest
app.get('/manifest.json', function(req, res) { res.json(STREAMING_MANIFEST); });

// Žánrový manifest — samostatná URL
app.get('/genre/manifest.json', function(req, res) { res.json(GENRE_MANIFEST); });

// Streaming katalógy
app.get('/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var skip = parseSkip(req.params.extra, req.query);

    var provider = null;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (id.startsWith(PROVIDERS[i].slug)) { provider = PROVIDERS[i]; break; }
    }
    if (!provider) return res.json({ metas: [] });

    await ensureProviderCache(provider);
    var c = providerCache[provider.slug];
    var all = type === 'movie' ? c.movies : c.tv;
    var mediaType = type === 'movie' ? 'movie' : 'tv';
    var items = all.map(function(x) { return toItem(x, mediaType); }).slice(skip, skip + 20);
    res.json({ metas: items });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

// Žánrový katalóg
app.get('/genre/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var skip = parseSkip(req.params.extra, req.query);
    var mediaType = type === 'movie' ? 'movie' : 'tv';
    var params = '';

    if (id.startsWith('genre-movie-') || id.startsWith('genre-tv-')) {
      var genreId = id.replace('genre-movie-', '').replace('genre-tv-', '');
      if (genreId !== 'top' && genreId !== 'new' && genreId !== 'pop') {
        params = 'with_genres=' + genreId + '&sort_by=popularity.desc&vote_count.gte=20';
      }
    }

    if (id === 'genre-movie-top' || id === 'genre-tv-top') {
      params = 'sort_by=vote_average.desc&vote_count.gte=300';
    } else if (id === 'genre-movie-new' || id === 'genre-tv-new') {
      var df = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
      params = 'sort_by=' + df + '.desc&vote_count.gte=10';
    } else if (id === 'genre-movie-pop' || id === 'genre-tv-pop') {
      params = 'sort_by=popularity.desc';
    }

    if (!params) return res.json({ metas: [] });

    var metas = await fetchGenreCatalog(mediaType, params, skip);
    console.log('[genre] ' + id + ' skip=' + skip + ' -> ' + metas.length);
    res.json({ metas: metas });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/', function(req, res) {
  var rows = PROVIDERS.map(function(p) {
    var c = providerCache[p.slug];
    var age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nahrava sa';
    return p.name + ': Filmy ' + c.movies.length + ', Serialy ' + c.tv.length + ' (' + age + ')';
  }).join('\n');
  res.send('<pre>CZ Streaming Katalogy v5.1 + Žánrový katalóg v1.0\n\n'
    + rows
    + '\n\nStreaming: <a href="/manifest.json">/manifest.json</a>'
    + '\nŽánrový:  <a href="/genre/manifest.json">/genre/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server na porte ' + PORT);
  (async function() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      await buildProviderCache(PROVIDERS[i]);
    }
  })();
});
