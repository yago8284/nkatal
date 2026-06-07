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

const MOVIE_GENRE_OPTIONS = [
  { value: '28',    title: 'Akcia'         },
  { value: '12',    title: 'Dobrodružstvo' },
  { value: '16',    title: 'Animácia'      },
  { value: '35',    title: 'Komédia'       },
  { value: '80',    title: 'Krimi'         },
  { value: '99',    title: 'Dokumentárny'  },
  { value: '18',    title: 'Dráma'         },
  { value: '10751', title: 'Rodinný'       },
  { value: '14',    title: 'Fantasy'       },
  { value: '27',    title: 'Horor'         },
  { value: '9648',  title: 'Mysteriózny'   },
  { value: '10749', title: 'Romantický'    },
  { value: '878',   title: 'Sci-Fi'        },
  { value: '53',    title: 'Thriller'      },
  { value: '10752', title: 'Vojnový'       },
  { value: '37',    title: 'Western'       },
];

const TV_GENRE_OPTIONS = [
  { value: '10759', title: 'Akcia'          },
  { value: '16',    title: 'Animácia'       },
  { value: '35',    title: 'Komédia'        },
  { value: '80',    title: 'Krimi'          },
  { value: '99',    title: 'Dokumentárny'   },
  { value: '18',    title: 'Dráma'          },
  { value: '10751', title: 'Rodinný'        },
  { value: '9648',  title: 'Mysteriózny'    },
  { value: '878',   title: 'Sci-Fi'         },
  { value: '10765', title: 'Sci-Fi/Fantasy' },
  { value: '53',    title: 'Thriller'       },
];

const YEAR_OPTIONS = [
  { value: '2025', title: '2025' },
  { value: '2024', title: '2024' },
  { value: '2023', title: '2023' },
  { value: '2022', title: '2022' },
  { value: '2021', title: '2021' },
  { value: '2020', title: '2020' },
  { value: '2019', title: '2019' },
  { value: '2018', title: '2018' },
  { value: '2015-2017', title: '2015–2017' },
  { value: '2010-2014', title: '2010–2014' },
  { value: '2000-2009', title: '2000–2009' },
  { value: '1990-1999', title: '90-te roky' },
  { value: '1980-1989', title: '80-te roky' },
  { value: '1900-1979', title: 'Klasika'    },
];

const SORT_OPTIONS = [
  { value: 'popularity.desc',          title: 'Najpopulárnejšie' },
  { value: 'vote_average.desc',        title: 'Najlepšie hodnotené' },
  { value: 'primary_release_date.desc', title: 'Najnovšie' },
];

const SORT_OPTIONS_TV = [
  { value: 'popularity.desc',       title: 'Najpopulárnejšie' },
  { value: 'vote_average.desc',     title: 'Najlepšie hodnotené' },
  { value: 'first_air_date.desc',   title: 'Najnovšie' },
];

// Extra filtre pre katalógy
const MOVIE_EXTRA = [
  { name: 'skip',  isRequired: false },
  { name: 'genre', isRequired: false, options: MOVIE_GENRE_OPTIONS },
  { name: 'year',  isRequired: false, options: YEAR_OPTIONS },
  { name: 'sort',  isRequired: false, options: SORT_OPTIONS },
];

const TV_EXTRA = [
  { name: 'skip',  isRequired: false },
  { name: 'genre', isRequired: false, options: TV_GENRE_OPTIONS },
  { name: 'year',  isRequired: false, options: YEAR_OPTIONS },
  { name: 'sort',  isRequired: false, options: SORT_OPTIONS_TV },
];

let cache = {};
PROVIDERS.forEach(function(p) {
  cache[p.slug] = { movies: [], tv: [], lastFetch: 0, building: false };
});

const MANIFEST = {
  id: 'community.cz-streaming-catalogs',
  version: '5.0.0',
  name: 'CZ Streaming Katalogy',
  description: 'Netflix, Disney+, Prime Video, HBO Max – filtrovanie podla zanru a roku',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: PROVIDERS.flatMap(function(p) {
    return [
      { type: 'movie',  id: p.slug + '-cz-movies', name: p.name + ' CZ - Filmy',   extra: MOVIE_EXTRA },
      { type: 'series', id: p.slug + '-cz-series', name: p.name + ' CZ - Serialy', extra: TV_EXTRA   },
    ];
  }),
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

// Parsovanie extra parametrov z URL path alebo query stringu
// Nuvio posiela napr: /catalog/movie/netflix-cz-movies/genre=28&year=2024&skip=20.json
function parseExtra(extraStr, query) {
  var params = { skip: 0, genre: null, year: null, sort: null };
  if (extraStr) {
    var parts = extraStr.split('&');
    parts.forEach(function(part) {
      var kv = part.split('=');
      if (kv.length === 2) params[kv[0]] = kv[1];
    });
  }
  if (query.skip)  params.skip  = parseInt(query.skip);
  if (query.genre) params.genre = query.genre;
  if (query.year)  params.year  = query.year;
  if (query.sort)  params.sort  = query.sort;
  if (params.skip) params.skip = parseInt(params.skip);
  return params;
}

// Fetch priamo z TMDB s filtrami — stránkovaný
async function fetchFromTMDB(mediaType, providerId, filters) {
  var skip = filters.skip || 0;
  var page = Math.floor(skip / 20) + 1;

  var sort = filters.sort || 'popularity.desc';
  // Oprava sort parametra pre TV
  if (mediaType === 'tv' && sort === 'primary_release_date.desc') {
    sort = 'first_air_date.desc';
  }

  var url = 'https://api.themoviedb.org/3/discover/' + mediaType
    + '?api_key=' + TMDB_KEY
    + '&with_watch_providers=' + providerId
    + '&watch_region=CZ'
    + '&language=cs-CZ'
    + '&include_adult=false'
    + '&sort_by=' + sort
    + '&page=' + page;

  if (filters.genre) {
    url += '&with_genres=' + filters.genre;
  }

  if (filters.year) {
    var yearVal = filters.year;
    var dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (yearVal.includes('-')) {
      var parts = yearVal.split('-');
      url += '&' + dateField + '.gte=' + parts[0] + '-01-01';
      url += '&' + dateField + '.lte=' + parts[1] + '-12-31';
    } else {
      url += '&' + dateField + '.gte=' + yearVal + '-01-01';
      url += '&' + dateField + '.lte=' + yearVal + '-12-31';
    }
  }

  var d = await tmdbFetch(url);
  return d.results || [];
}

// Cache pre prípad bez filtrov (rýchlejší prvý load)
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
var MOVIE_GENRE_IDS = [28,12,16,35,80,99,18,10751,14,36,27,9648,10749,878,53,10752,37];
var TV_GENRE_IDS    = [10759,16,35,80,99,18,10751,9648,878,10765,53];

async function buildProviderCache(provider) {
  var c = cache[provider.slug];
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
    buildPromises[provider.slug] = buildProviderCache(provider).finally(function() {
      delete buildPromises[provider.slug];
    });
  }
  await Promise.race([buildPromises[provider.slug], new Promise(function(r) { setTimeout(r, 120000); })]);
}

app.get('/manifest.json', function(req, res) { res.json(MANIFEST); });

app.get('/catalog/:type/:id/:extra?.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extraStr = req.params.extra || '';
    var filters = parseExtra(extraStr, req.query);

    var provider = null;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (id.startsWith(PROVIDERS[i].slug)) { provider = PROVIDERS[i]; break; }
    }
    if (!provider) return res.json({ metas: [] });

    var mediaType = type === 'movie' ? 'movie' : 'tv';
    var hasFilters = filters.genre || filters.year || filters.sort;

    var items;

    if (hasFilters) {
      // S filtrami — fetchni priamo z TMDB
      var raw = await fetchFromTMDB(mediaType, provider.id, filters);
      items = raw.map(function(x) { return toItem(x, mediaType); });
    } else {
      // Bez filtrov — použi cache
      await ensureProviderCache(provider);
      var c = cache[provider.slug];
      var all = type === 'movie' ? c.movies : c.tv;
      var skip = filters.skip || 0;
      items = all.map(function(x) { return toItem(x, mediaType); }).slice(skip, skip + 20);
      return res.json({ metas: items });
    }

    console.log('[catalog] ' + id + ' filters=' + JSON.stringify(filters) + ' -> ' + items.length);
    res.json({ metas: items });
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
  res.send('<pre>CZ Streaming Katalogy v5.0\n\n' + rows + '\n\n<a href="/manifest.json">/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server na porte ' + PORT);
  (async function() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      await buildProviderCache(PROVIDERS[i]);
    }
  })();
});
