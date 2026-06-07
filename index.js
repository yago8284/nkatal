const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// ── Streaming provideri ──────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 8,    name: 'Netflix',     slug: 'netflix' },
  { id: 337,  name: 'Disney+',     slug: 'disney'  },
  { id: 119,  name: 'Prime Video', slug: 'prime'   },
  { id: 1899, name: 'HBO Max',     slug: 'hbo'     },
];

// ── Žánre pre katalóg s filtrami ─────────────────────────────────────────────
const GENRES = [
  { id: 28,    name: 'Akcia'        },
  { id: 12,    name: 'Dobrodružstvo'},
  { id: 16,    name: 'Animácia'     },
  { id: 35,    name: 'Komédia'      },
  { id: 80,    name: 'Krimi'        },
  { id: 99,    name: 'Dokumentárny' },
  { id: 18,    name: 'Dráma'        },
  { id: 10751, name: 'Rodinný'      },
  { id: 14,    name: 'Fantasy'      },
  { id: 27,    name: 'Horor'        },
  { id: 9648,  name: 'Mysteriózny'  },
  { id: 10749, name: 'Romantický'   },
  { id: 878,   name: 'Sci-Fi'       },
  { id: 53,    name: 'Thriller'     },
  { id: 10752, name: 'Vojnový'      },
  { id: 37,    name: 'Western'      },
];

const TV_GENRES = [
  { id: 10759, name: 'Akcia'        },
  { id: 16,    name: 'Animácia'     },
  { id: 35,    name: 'Komédia'      },
  { id: 80,    name: 'Krimi'        },
  { id: 99,    name: 'Dokumentárny' },
  { id: 18,    name: 'Dráma'        },
  { id: 10751, name: 'Rodinný'      },
  { id: 9648,  name: 'Mysteriózny'  },
  { id: 878,   name: 'Sci-Fi'       },
  { id: 10765, name: 'Sci-Fi/Fantasy'},
  { id: 53,    name: 'Thriller'     },
];

const DECADES = [
  { label: '2020+',  from: 2020, to: 2026 },
  { label: '2010+',  from: 2010, to: 2019 },
  { label: '2000+',  from: 2000, to: 2009 },
  { label: '90-te',  from: 1990, to: 1999 },
  { label: '80-te',  from: 1980, to: 1989 },
  { label: 'Klasika', from: 1900, to: 1979 },
];

const MOVIE_GENRES_IDS = [28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37];
const TV_GENRES_IDS   = [10759,16,35,80,99,18,10751,10762,9648,10763,10764,878,10765,10766,10767,10768,37];

// ── Cache ────────────────────────────────────────────────────────────────────
let cache = {};
PROVIDERS.forEach(function(p) {
  cache[p.slug] = { movies: [], tv: [], lastFetch: 0, building: false };
});

// ── Manifest ─────────────────────────────────────────────────────────────────
// Streaming katalógy
var streamingCatalogs = PROVIDERS.flatMap(function(p) {
  return [
    { type: 'movie',  id: p.slug + '-cz-movies', name: p.name + ' CZ - Filmy',   extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: p.slug + '-cz-series', name: p.name + ' CZ - Serialy', extra: [{ name: 'skip', isRequired: false }] },
  ];
});

// Katalógy s filtrami — každý žáner zvlášť + každá dekáda zvlášť
var filterCatalogs = [];

// Podľa žánru — filmy
GENRES.forEach(function(g) {
  filterCatalogs.push({
    type: 'movie',
    id: 'filter-movie-genre-' + g.id,
    name: 'Filmy: ' + g.name,
    extra: [{ name: 'skip', isRequired: false }]
  });
});

// Podľa žánru — seriály
TV_GENRES.forEach(function(g) {
  filterCatalogs.push({
    type: 'series',
    id: 'filter-tv-genre-' + g.id,
    name: 'Serialy: ' + g.name,
    extra: [{ name: 'skip', isRequired: false }]
  });
});

// Podľa dekády — filmy
DECADES.forEach(function(d) {
  filterCatalogs.push({
    type: 'movie',
    id: 'filter-movie-decade-' + d.from,
    name: 'Filmy: ' + d.label,
    extra: [{ name: 'skip', isRequired: false }]
  });
});

// Podľa dekády — seriály
DECADES.forEach(function(d) {
  filterCatalogs.push({
    type: 'series',
    id: 'filter-tv-decade-' + d.from,
    name: 'Serialy: ' + d.label,
    extra: [{ name: 'skip', isRequired: false }]
  });
});

// Top zoznamy
filterCatalogs.push({ type: 'movie',  id: 'filter-movie-top',    name: 'Filmy: Top hodnotenie',   extra: [{ name: 'skip', isRequired: false }] });
filterCatalogs.push({ type: 'series', id: 'filter-tv-top',       name: 'Serialy: Top hodnotenie', extra: [{ name: 'skip', isRequired: false }] });
filterCatalogs.push({ type: 'movie',  id: 'filter-movie-new',    name: 'Filmy: Najnovsie',        extra: [{ name: 'skip', isRequired: false }] });
filterCatalogs.push({ type: 'series', id: 'filter-tv-new',       name: 'Serialy: Najnovsie',      extra: [{ name: 'skip', isRequired: false }] });

const MANIFEST = {
  id: 'community.cz-streaming-catalogs',
  version: '4.0.0',
  name: 'CZ Streaming + Katalog',
  description: 'Netflix, Disney+, Prime Video, HBO Max + katalog podla zanru a roku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: streamingCatalogs.concat(filterCatalogs),
  idPrefixes: ['tmdb:'],
};

// ── Express ───────────────────────────────────────────────────────────────────
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbGet(path) {
  var sep = path.includes('?') ? '&' : '?';
  var r = await fetch('https://api.themoviedb.org/3' + path + sep + 'api_key=' + TMDB_KEY);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

async function fetchPage(url) {
  var r = await fetch(url + '&api_key=' + TMDB_KEY);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

// Fetch podľa filtrov — priamo stránkovaný (nepotrebuje cache)
async function fetchFiltered(mediaType, params, skip) {
  var page = Math.floor(skip / 20) + 1;
  var base = 'https://api.themoviedb.org/3/discover/' + mediaType + '?' + params + '&language=cs-CZ&include_adult=false&page=' + page;
  var d = await fetchPage(base);
  return d.results || [];
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

// ── Streaming cache ───────────────────────────────────────────────────────────
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

var buildPromises = {};

async function buildProviderCache(provider) {
  var c = cache[provider.slug];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + provider.name + '] Budovanie cache...');
  try {
    var mg = [fetchGenre('movie', provider.id, null, 20)].concat(MOVIE_GENRES_IDS.map(function(g) { return fetchGenre('movie', provider.id, g, 5); }));
    var tg = [fetchGenre('tv', provider.id, null, 20)].concat(TV_GENRES_IDS.map(function(g) { return fetchGenre('tv', provider.id, g, 5); }));
    var results = await Promise.all([Promise.all(mg), Promise.all(tg)]);
    var movies = dedup(results[0].reduce(function(a, b) { return a.concat(b); }, []));
    var tv = dedup(results[1].reduce(function(a, b) { return a.concat(b); }, []));
    movies.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    tv.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    cache[provider.slug] = { movies: movies, tv: tv, lastFetch: Date.now(), building: false };
    console.log('[' + provider.name + '] ' + movies.length + ' filmov, ' + tv.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + provider.name + '] Chyba: ' + e.message);
  }
}

async function ensureProviderCache(provider) {
  var c = cache[provider.slug];
  if (c.movies.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[provider.slug]) {
    buildPromises[provider.slug] = buildProviderCache(provider).finally(function() { delete buildPromises[provider.slug]; });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(function(r) { setTimeout(r, 120000); })]);
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/manifest.json', function(req, res) { res.json(MANIFEST); });

app.get('/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extra = req.params.extra || '';
    var skip = 0;
    var m = extra.match(/skip=(\d+)/);
    if (m) skip = parseInt(m[1]);
    if (req.query.skip) skip = parseInt(req.query.skip);

    // ── Streaming katalógy ──
    var provider = null;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (id.startsWith(PROVIDERS[i].slug)) { provider = PROVIDERS[i]; break; }
    }
    if (provider) {
      await ensureProviderCache(provider);
      var c = cache[provider.slug];
      var items = [];
      if (id === provider.slug + '-cz-movies' && type === 'movie') {
        items = c.movies.map(function(x) { return toItem(x, 'movie'); });
      } else if (id === provider.slug + '-cz-series' && type === 'series') {
        items = c.tv.map(function(x) { return toItem(x, 'tv'); });
      }
      return res.json({ metas: items.slice(skip, skip + 20) });
    }

    // ── Filter katalógy ──
    if (id.startsWith('filter-')) {
      var mediaType = type === 'movie' ? 'movie' : 'tv';
      var params = 'sort_by=popularity.desc';

      if (id.startsWith('filter-movie-genre-') || id.startsWith('filter-tv-genre-')) {
        var genreId = id.replace('filter-movie-genre-', '').replace('filter-tv-genre-', '');
        params = 'with_genres=' + genreId + '&sort_by=popularity.desc&vote_count.gte=50';
      } else if (id.startsWith('filter-movie-decade-') || id.startsWith('filter-tv-decade-')) {
        var fromYear = parseInt(id.replace('filter-movie-decade-', '').replace('filter-tv-decade-', ''));
        var decade = DECADES.find(function(d) { return d.from === fromYear; });
        if (decade) {
          var dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
          params = dateField + '.gte=' + decade.from + '-01-01&' + dateField + '.lte=' + decade.to + '-12-31&sort_by=popularity.desc&vote_count.gte=20';
        }
      } else if (id === 'filter-movie-top' || id === 'filter-tv-top') {
        params = 'sort_by=vote_average.desc&vote_count.gte=500';
      } else if (id === 'filter-movie-new' || id === 'filter-tv-new') {
        var dateField2 = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
        params = 'sort_by=' + dateField2 + '.desc&vote_count.gte=10';
      }

      var filtered = await fetchFiltered(mediaType, params, skip);
      var metas = filtered.map(function(x) { return toItem(x, mediaType); });
      console.log('[filter] ' + id + ' skip=' + skip + ' -> ' + metas.length);
      return res.json({ metas: metas });
    }

    res.json({ metas: [] });
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
  res.send('<pre>CZ Streaming Katalogy v4.0\n\n' + rows + '\n\nFilter katalogy: ' + filterCatalogs.length + ' katalogov\n\n<a href="/manifest.json">/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server na porte ' + PORT);
  (async function() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      await buildProviderCache(PROVIDERS[i]);
    }
  })();
});
