const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// Paramount+ nie je dostupny v CZ/SK - odstraneny
const PROVIDERS = [
  { id: 8,    name: 'Netflix',     slug: 'netflix' },
  { id: 337,  name: 'Disney+',     slug: 'disney'  },
  { id: 119,  name: 'Prime Video', slug: 'prime'   },
  { id: 1899, name: 'HBO Max',     slug: 'hbo'     },
  { id: 350,  name: 'Apple TV+',   slug: 'apple'   },
];

const MOVIE_GENRE_IDS = [28,12,16,35,80,99,18,10751,14,27,9648,10749,878,53,10752,37];
const TV_GENRE_IDS    = [10759,16,35,80,99,18,10751,9648,878,10765,53];

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

// Cache — jeden zaznam na providera (CZ+SK spojene)
var providerCache = {};
PROVIDERS.forEach(function(p) {
  providerCache[p.slug] = { movies: [], tv: [], lastFetch: 0, building: false };
});

// Streaming manifest — CZ+SK spojene
var streamingCatalogs = [];
PROVIDERS.forEach(function(p) {
  streamingCatalogs.push({ type: 'movie',  id: p.slug + '-czsk-movies', name: p.name + ' CZ+SK - Filmy',   extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }] });
  streamingCatalogs.push({ type: 'series', id: p.slug + '-czsk-series', name: p.name + ' CZ+SK - Serialy', extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }] });
});

streamingCatalogs.push({ type: 'movie',  id: 'trending-movies-day',   name: '🔥 Trending Filmy - Dnes',          extra: [{ name: 'skip', isRequired: false }] });
streamingCatalogs.push({ type: 'series', id: 'trending-series-day',   name: '🔥 Trending Serialy - Dnes',        extra: [{ name: 'skip', isRequired: false }] });
streamingCatalogs.push({ type: 'movie',  id: 'trending-movies-week',  name: '📈 Trending Filmy - Tento tyždeň',  extra: [{ name: 'skip', isRequired: false }] });
streamingCatalogs.push({ type: 'series', id: 'trending-series-week',  name: '📈 Trending Serialy - Tento tyždeň', extra: [{ name: 'skip', isRequired: false }] });

const STREAMING_MANIFEST = {
  id: 'community.cz-streaming-catalogs',
  version: '6.1.0',
  name: 'CZ+SK Streaming Katalogy',
  description: 'Netflix, Disney+, Prime Video, HBO Max, Apple TV+ pre CZ a SK',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: streamingCatalogs,
  idPrefixes: ['tmdb:'],
};

// Žánrový manifest
var genreCatalogs = [].concat(
  MOVIE_GENRES.map(function(g) {
    return { type: 'movie',  id: 'genre-movie-' + g.id, name: '🎬 ' + g.name, extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }] };
  }),
  TV_GENRES.map(function(g) {
    return { type: 'series', id: 'genre-tv-' + g.id,    name: '📺 ' + g.name, extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }] };
  }),
  [
    { type: 'movie',  id: 'genre-movie-top', name: '⭐ Filmy - Top hodnotenie',      extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'genre-tv-top',    name: '⭐ Serialy - Top hodnotenie',    extra: [{ name: 'skip', isRequired: false }] },
    { type: 'movie',  id: 'genre-movie-new', name: '🆕 Filmy - Najnovsie',           extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'genre-tv-new',    name: '🆕 Serialy - Najnovsie',         extra: [{ name: 'skip', isRequired: false }] },
    { type: 'movie',  id: 'genre-movie-pop', name: '🔥 Filmy - Najpopularnejsie',    extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'genre-tv-pop',    name: '🔥 Serialy - Najpopularnejsie',  extra: [{ name: 'skip', isRequired: false }] },
  ]
);

const GENRE_MANIFEST = {
  id: 'community.cz-genre-catalog',
  version: '2.1.0',
  name: 'CZ Katalog podla zanru',
  description: 'Vsetky filmy a serialy zo vsetkych sluzieb podla zanru + vyhladavanie',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: genreCatalogs,
  idPrefixes: ['tmdb:'],
};

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

function parseExtra(extraStr, query) {
  var params = { skip: 0, search: null };
  if (extraStr) {
    extraStr.split('&').forEach(function(part) {
      var kv = part.split('=');
      if (kv.length >= 2) params[kv[0]] = decodeURIComponent(kv.slice(1).join('='));
    });
  }
  if (query.skip)   params.skip   = parseInt(query.skip) || 0;
  if (query.search) params.search = query.search;
  return params;
}

function dedup(arr) {
  var seen = {};
  return arr.filter(function(item) {
    if (!item || !item.id || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });
}

// Fetch pre cache — CZ aj SK naraz, vysledky spojene a deduplikovane
async function fetchForCache(mediaType, providerId, genreId, maxPages) {
  maxPages = maxPages || 5;
  var results = [];
  var regions = ['CZ', 'SK'];
  for (var ri = 0; ri < regions.length; ri++) {
    var base = 'https://api.themoviedb.org/3/discover/' + mediaType
      + '?api_key=' + TMDB_KEY
      + '&with_watch_providers=' + providerId
      + '&watch_region=' + regions[ri]
      + '&language=cs-CZ&include_adult=false'
      + (genreId ? '&with_genres=' + genreId : '')
      + '&sort_by=popularity.desc';
    for (var p = 1; p <= maxPages; p++) {
      try {
        var d = await tmdbFetch(base + '&page=' + p);
        results = results.concat(d.results || []);
        if (p >= (d.total_pages || 1)) break;
        await new Promise(function(r) { setTimeout(r, 80); });
      } catch(e) { break; }
    }
  }
  return results;
}

var buildPromises = {};

async function buildProviderCache(provider) {
  var c = providerCache[provider.slug];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + provider.name + ' CZ+SK] Budovanie cache...');
  try {
    var mg = [fetchForCache('movie', provider.id, null, 20)].concat(
      MOVIE_GENRE_IDS.map(function(g) { return fetchForCache('movie', provider.id, g, 5); })
    );
    var tg = [fetchForCache('tv', provider.id, null, 20)].concat(
      TV_GENRE_IDS.map(function(g) { return fetchForCache('tv', provider.id, g, 5); })
    );
    var results = await Promise.all([Promise.all(mg), Promise.all(tg)]);
    var movies = dedup(results[0].reduce(function(a, b) { return a.concat(b); }, []));
    var tv     = dedup(results[1].reduce(function(a, b) { return a.concat(b); }, []));
    movies.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    tv.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    providerCache[provider.slug] = { movies: movies, tv: tv, lastFetch: Date.now(), building: false };
    console.log('[' + provider.name + '] ' + movies.length + ' filmov, ' + tv.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + provider.name + '] Chyba: ' + e.message);
  }
}

async function ensureCache(provider) {
  var c = providerCache[provider.slug];
  if (c.movies.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[provider.slug]) {
    buildPromises[provider.slug] = buildProviderCache(provider).finally(function() { delete buildPromises[provider.slug]; });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(function(r) { setTimeout(r, 120000); })]);
}

async function searchTMDB(mediaType, query, page) {
  var url = 'https://api.themoviedb.org/3/search/' + mediaType
    + '?api_key=' + TMDB_KEY
    + '&query=' + encodeURIComponent(query)
    + '&language=cs-CZ&include_adult=false&page=' + (page || 1);
  var d = await tmdbFetch(url);
  return (d.results || []).map(function(x) { return toItem(x, mediaType); });
}

var trendingCache = { data: {}, lastFetch: {} };

async function getTrending(mediaType, window) {
  var key = mediaType + '-' + window;
  if (trendingCache.data[key] && Date.now() - (trendingCache.lastFetch[key] || 0) < 3600000) {
    return trendingCache.data[key];
  }
  var results = [];
  for (var p = 1; p <= 5; p++) {
    try {
      var d = await tmdbFetch('https://api.themoviedb.org/3/trending/' + mediaType + '/' + window + '?api_key=' + TMDB_KEY + '&language=cs-CZ&page=' + p);
      results = results.concat((d.results || []).map(function(x) { return toItem(x, mediaType); }));
      if (p >= (d.total_pages || 1)) break;
    } catch(e) { break; }
  }
  trendingCache.data[key] = results;
  trendingCache.lastFetch[key] = Date.now();
  return results;
}

async function fetchGenreCatalog(mediaType, params, skip) {
  var page = Math.floor(skip / 20) + 1;
  var allProviders = PROVIDERS.map(function(p) { return p.id; }).join('|');
  var url = 'https://api.themoviedb.org/3/discover/' + mediaType
    + '?api_key=' + TMDB_KEY
    + '&with_watch_providers=' + allProviders
    + '&watch_region=CZ&language=cs-CZ&include_adult=false'
    + '&' + params + '&page=' + page;
  var d = await tmdbFetch(url);
  return (d.results || []).map(function(x) { return toItem(x, mediaType); });
}

app.get('/manifest.json', function(req, res) { res.json(STREAMING_MANIFEST); });
app.get('/genre/manifest.json', function(req, res) { res.json(GENRE_MANIFEST); });

app.get('/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extra = parseExtra(req.params.extra || '', req.query);
    var mediaType = type === 'movie' ? 'movie' : 'tv';

    if (id.startsWith('trending-')) {
      var window = id.endsWith('-week') ? 'week' : 'day';
      var all = await getTrending(mediaType, window);
      return res.json({ metas: all.slice(extra.skip, extra.skip + 20) });
    }

    var provider = null;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (id.startsWith(PROVIDERS[i].slug)) { provider = PROVIDERS[i]; break; }
    }
    if (!provider) return res.json({ metas: [] });

    if (extra.search) {
      var sr = await searchTMDB(mediaType, extra.search, Math.floor(extra.skip / 20) + 1);
      return res.json({ metas: sr });
    }

    await ensureCache(provider);
    var c = providerCache[provider.slug];
    var all2 = type === 'movie' ? c.movies : c.tv;
    var items = all2.map(function(x) { return toItem(x, mediaType); }).slice(extra.skip, extra.skip + 20);
    res.json({ metas: items });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/genre/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extra = parseExtra(req.params.extra || '', req.query);
    var mediaType = type === 'movie' ? 'movie' : 'tv';

    if (extra.search) {
      var sr = await searchTMDB(mediaType, extra.search, Math.floor(extra.skip / 20) + 1);
      return res.json({ metas: sr });
    }

    var params = '';
    if (id.startsWith('genre-movie-') || id.startsWith('genre-tv-')) {
      var genreId = id.replace('genre-movie-', '').replace('genre-tv-', '');
      if (genreId !== 'top' && genreId !== 'new' && genreId !== 'pop') {
        params = 'with_genres=' + genreId + '&sort_by=popularity.desc&vote_count.gte=20';
      }
    }
    if (id === 'genre-movie-top' || id === 'genre-tv-top') params = 'sort_by=vote_average.desc&vote_count.gte=300';
    if (id === 'genre-movie-new' || id === 'genre-tv-new') params = 'sort_by=' + (mediaType === 'movie' ? 'primary_release_date' : 'first_air_date') + '.desc&vote_count.gte=10';
    if (id === 'genre-movie-pop' || id === 'genre-tv-pop') params = 'sort_by=popularity.desc';
    if (!params) return res.json({ metas: [] });

    var metas = await fetchGenreCatalog(mediaType, params, extra.skip);
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
    return p.name + ' CZ+SK: Filmy ' + c.movies.length + ', Serialy ' + c.tv.length + ' (' + age + ')';
  }).join('\n');
  res.send('<pre>CZ+SK Streaming Katalogy v6.1\n\n' + rows
    + '\n\nStreaming: <a href="/manifest.json">/manifest.json</a>'
    + '\nZanrovy:   <a href="/genre/manifest.json">/genre/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server na porte ' + PORT);
  (async function() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      await buildProviderCache(PROVIDERS[i]);
    }
  })();
});
