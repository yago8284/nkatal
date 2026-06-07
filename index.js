const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { movies: [], tv: [], lastFetch: 0, building: false };

const MANIFEST = {
  id: "community.netflix-cz-catalog",
  version: "2.0.0",
  name: "Netflix CZ",
  description: "Filmy a seriály dostupné na Netflixe v Česku",
  logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "netflix-cz-movies",
      name: "Netflix CZ – Filmy",
      extra: [{ name: "skip", isRequired: false }],
    },
    {
      type: "series",
      id: "netflix-cz-series",
      name: "Netflix CZ – Seriály",
      extra: [{ name: "skip", isRequired: false }],
    },
  ],
  idPrefixes: ["tmdb:"],
};

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// TMDB žánre pre filmy a seriály
const MOVIE_GENRES = [
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770,
  53, 10752, 37,
];
const TV_GENRES = [
  10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 878, 10765,
  10766, 10767, 10768, 37,
];

async function tmdbGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

async function fetchGenre(mediaType, genreId, maxPages = 10) {
  const base =
    mediaType === "movie"
      ? `/discover/movie?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false&with_genres=${genreId}&sort_by=popularity.desc`
      : `/discover/tv?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false&with_genres=${genreId}&sort_by=popularity.desc`;

  const results = [];
  for (let p = 1; p <= maxPages; p++) {
    try {
      const d = await tmdbGet(`${base}&page=${p}`);
      results.push(...(d.results || []));
      if (p >= (d.total_pages || 1)) break;
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      console.error(` Žáner ${genreId} strana ${p}: ${e.message}`);
      break;
    }
  }
  return results;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    if (!item || !item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function toStremioItem(item, type) {
  return {
    id: `tmdb:${item.id}`,
    type: type === "movie" ? "movie" : "series",
    name:
      item.title ||
      item.name ||
      item.original_title ||
      item.original_name ||
      "",
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : undefined,
    background: item.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : undefined,
    description: item.overview || "",
    releaseInfo: (item.release_date || item.first_air_date || "").substring(
      0,
      4
    ),
    imdbRating: item.vote_average
      ? String(item.vote_average.toFixed(1))
      : undefined,
  };
}

let cachePromise = null;

async function buildCache() {
  if (!TMDB_KEY) {
    console.error("CHÝBA TMDB_API_KEY");
    return;
  }
  if (cache.building) return;
  if (Date.now() - cache.lastFetch < CACHE_TTL) return;

  cache.building = true;
  console.log("\n=== BUDOVANIE CACHE v2 ===");

  try {
    // --- FILMY: každý žáner zvlášť ---
    console.log(`Fetchujem ${MOVIE_GENRES.length} filmových žánrov...`);
    const movieBatches = await Promise.all(
      MOVIE_GENRES.map((g) => fetchGenre("movie", g, 5))
    );
    // + bez filtra žánru pre catch-all
    const movieAll = await fetchGenre("movie", "", 20).catch(() => []);

    const allMovies = dedup([...movieAll, ...movieBatches.flat()]);
    allMovies.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    console.log(`Filmy celkom: ${allMovies.length}`);

    // --- SERIÁLY: každý žáner zvlášť ---
    console.log(`Fetchujem ${TV_GENRES.length} TV žánrov...`);
    const tvBatches = await Promise.all(
      TV_GENRES.map((g) => fetchGenre("tv", g, 5))
    );
    const tvAll = await fetchGenre("tv", "", 20).catch(() => []);

    const allTv = dedup([...tvAll, ...tvBatches.flat()]);
    allTv.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    console.log(`Seriály celkom: ${allTv.length}`);

    cache = {
      movies: allMovies,
      tv: allTv,
      lastFetch: Date.now(),
      building: false,
    };
    console.log("=== CACHE HOTOVÁ ===");
  } catch (e) {
    cache.building = false;
    console.error("Chyba buildCache:", e.message);
  }
}

async function ensureCache() {
  if (cache.movies.length > 0 && Date.now() - cache.lastFetch < CACHE_TTL)
    return;
  if (!cachePromise) {
    cachePromise = buildCache().finally(() => {
      cachePromise = null;
    });
  }
  await Promise.race([cachePromise, new Promise((r) => setTimeout(r, 120000))]);
}

app.get("/manifest.json", (req, res) => res.json(MANIFEST));

app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    await ensureCache();
    const { type, id } = req.params;
    const skip = parseInt(req.query.skip || "0");
    const PAGE_SIZE = 20;

    let items = [];
    if (id === "netflix-cz-movies" && type === "movie") {
      items = cache.movies.map((m) => toStremioItem(m, "movie"));
    } else if (id === "netflix-cz-series" && type === "series") {
      items = cache.tv.map((m) => toStremioItem(m, "tv"));
    }

    console.log(
      `[catalog] ${id} skip=${skip} → ${ items.slice(skip, skip + PAGE_SIZE).length } z ${items.length}`
    );
    res.json({ metas: items.slice(skip, skip + PAGE_SIZE) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get("/", (req, res) => {
  const age = cache.lastFetch
    ? Math.round((Date.now() - cache.lastFetch) / 60000) + " min"
    : "ešte nenahrané";
  res.send(
    `<pre>Netflix CZ Addon v2.0\n` +
      `Filmy: ${cache.movies.length}\n` +
      `Seriály: ${cache.tv.length}\n` +
      `Cache: ${age} stará\n` +
      `Building: ${cache.building}\n\n` +
      `<a href="/manifest.json">/manifest.json</a></pre>`
  );
});

app.listen(PORT, () => {
  console.log(`Server štartuje na porte ${PORT}`);
  buildCache();
});
