const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hodín

let cache = { movies: [], tv: [], lastFetch: 0 };

const MANIFEST = {
  id: "community.netflix-cz-catalog",
  version: "1.1.0",
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
  behaviorHints: { configurable: false, configurationRequired: false },
};

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

async function tmdbGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`);
  return r.json();
}

// Fetchne všetky stránky jedného endpointu (max maxPages)
async function fetchAllPages(basePath, maxPages = 20) {
  const results = [];
  for (let p = 1; p <= maxPages; p++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const d = await tmdbGet(`${basePath}${sep}page=${p}`);
    results.push(...(d.results || []));
    if (p >= (d.total_pages || 1)) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  return results;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    if (seen.has(item.id)) return false;
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

async function refreshCache() {
  if (!TMDB_KEY) {
    console.error("Chýba TMDB_API_KEY!");
    return;
  }
  if (Date.now() - cache.lastFetch < CACHE_TTL) return;

  console.log("Obnova cache...");
  try {
    // --- FILMY ---
    // 1. Discover s Netflix providerom (CZ) — viacero sortov = viac unikátnych výsledkov
    const discoverMovieBase = `/discover/movie?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false`;
    const [mPop, mRated, mNew] = await Promise.all([
      fetchAllPages(`${discoverMovieBase}&sort_by=popularity.desc`, 20),
      fetchAllPages(
        `${discoverMovieBase}&sort_by=vote_average.desc&vote_count.gte=100`,
        10
      ),
      fetchAllPages(
        `${discoverMovieBase}&sort_by=primary_release_date.desc`,
        10
      ),
    ]);

    // 2. Netflix originály cez keyword (keyword ID 180547 = "netflix original")
    const mOriginals = await fetchAllPages(
      `/discover/movie?with_keywords=180547&watch_region=CZ&language=cs-CZ&sort_by=popularity.desc`,
      10
    );

    // 3. Top rated CZ tituly (nie len Netflix, ale odfiltrovane neskôr — zachováme pre pokrytie)
    const mTopCZ = await fetchAllPages(
      `/discover/movie?with_watch_providers=8&watch_region=CZ&language=cs-CZ&sort_by=vote_count.desc`,
      10
    );

    const allMoviesRaw = dedup([
      ...mPop,
      ...mRated,
      ...mNew,
      ...mOriginals,
      ...mTopCZ,
    ]);
    // Zoraď podľa popularity
    allMoviesRaw.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    // --- SERIÁLY ---
    const discoverTvBase = `/discover/tv?with_watch_providers=8&watch_region=CZ&language=cs-CZ&include_adult=false`;
    const [tvPop, tvRated, tvNew] = await Promise.all([
      fetchAllPages(`${discoverTvBase}&sort_by=popularity.desc`, 20),
      fetchAllPages(
        `${discoverTvBase}&sort_by=vote_average.desc&vote_count.gte=50`,
        10
      ),
      fetchAllPages(`${discoverTvBase}&sort_by=first_air_date.desc`, 10),
    ]);

    const tvOriginals = await fetchAllPages(
      `/discover/tv?with_keywords=180547&watch_region=CZ&language=cs-CZ&sort_by=popularity.desc`,
      10
    );

    const tvTopCZ = await fetchAllPages(
      `/discover/tv?with_watch_providers=8&watch_region=CZ&language=cs-CZ&sort_by=vote_count.desc`,
      10
    );

    const allTvRaw = dedup([
      ...tvPop,
      ...tvRated,
      ...tvNew,
      ...tvOriginals,
      ...tvTopCZ,
    ]);
    allTvRaw.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    cache = { movies: allMoviesRaw, tv: allTvRaw, lastFetch: Date.now() };
    console.log(
      `Cache obnovená: ${allMoviesRaw.length} filmov, ${allTvRaw.length} seriálov`
    );
  } catch (e) {
    console.error("Chyba pri obnove cache:", e.message);
  }
}

// Manifest
app.get("/manifest.json", (req, res) => {
  res.json(MANIFEST);
});

// Catalog
app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    await refreshCache();
    const { type, id } = req.params;
    const skip = parseInt(req.query.skip || "0");
    const PAGE_SIZE = 20;

    let items = [];
    if (id === "netflix-cz-movies" && type === "movie") {
      items = cache.movies.map((m) => toStremioItem(m, "movie"));
    } else if (id === "netflix-cz-series" && type === "series") {
      items = cache.tv.map((m) => toStremioItem(m, "tv"));
    }

    res.json({ metas: items.slice(skip, skip + PAGE_SIZE) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

// Health check
app.get("/", (req, res) => {
  const age = cache.lastFetch
    ? Math.round((Date.now() - cache.lastFetch) / 60000) + " min"
    : "ešte nenahrané";
  res.send(
    `Netflix CZ Addon v1.1 ✓<br>` +
      `Filmy: ${cache.movies.length}<br>` +
      `Seriály: ${cache.tv.length}<br>` +
      `Cache vek: ${age}<br>` +
      `Manifest: <a href="/manifest.json">/manifest.json</a>`
  );
});

app.listen(PORT, () => {
  console.log(`Server beží na porte ${PORT}`);
  refreshCache();
});
