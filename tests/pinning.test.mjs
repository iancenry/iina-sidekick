import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, settle, searchedQueries } from "./helpers/harness.mjs";

const KEY = { epinfo_tmdb_key: "TESTKEY" };

const SHOW = {
  id: 1399,
  name: "Severance",
  poster_path: "/p.jpg",
  number_of_seasons: 2,
  number_of_episodes: 19,
  seasons: [{ season_number: 1, episode_count: 9 }, { season_number: 2, episode_count: 10 }],
  images: { logos: [{ file_path: "/logo.jpg", aspect_ratio: 6, iso_639_1: "en" }] }
};
const SEASON_1 = {
  poster_path: "/s1.jpg",
  episodes: [
    { episode_number: 1, name: "Good News About Hell", air_date: "2022-02-18" },
    { episode_number: 2, name: "Half Loop", air_date: "2022-02-25" }
  ]
};
const SEASON_2 = {
  poster_path: "/s2.jpg",
  episodes: [
    { episode_number: 1, name: "Hello, Ms. Cobel", air_date: "2025-02-21" },
    { episode_number: 2, name: "In Perpetuity", air_date: "2025-02-28" },
    { episode_number: 3, name: "Chikhai Bardo", air_date: "2025-03-07" }
  ]
};

const LIB = "file:///Users/me/Downloads/watch/me/samurai%20champloo";

function boot(over = {}) {
  return loadSidebar({
    storage: { ...KEY, ...(over.storage || {}) },
    routes: {
      "/3/search/tv": { results: [] },
      "/3/search/multi": { results: [] },
      "/3/tv/1399/season/1": SEASON_1,
      "/3/tv/1399/season/2": SEASON_2,
      "/3/tv/1399": SHOW,
      ...(over.routes || {})
    }
  });
}

function urlMap(h) {
  try { return JSON.parse(h.localStorage.getItem("epinfo_url_map") || "{}"); } catch (e) { return {}; }
}

function folderMap(h) {
  try { return JSON.parse(h.localStorage.getItem("epinfo_folder_map") || "{}"); }
  catch (e) { return {}; }
}

function selected(h) {
  const p = h.iina._posted.filter((x) => x.name === "episodeSelected");
  return p.length ? p[p.length - 1].payload : null;
}

// Search finds it, so a manual pick has something to pick.
const SEVERANCE_RESULTS = {
  results: [
    { id: 1399, media_type: "tv", name: "Severance", vote_count: 4000, poster_path: "/p.jpg" }
  ]
};

async function manualPick(h, url) {
  // What a user does: open the file, search, click the show, click a season,
  // click an episode.
  await manualPickShow(h, url, { id: 1399, media_type: "tv", name: "Severance", poster_path: "/p.jpg" }, 1, 0);
}

// The same, for a test that needs its own show. `seasonNumber` and `epIndex`
// are what the user clicks.
async function manualPickShow(h, url, item, seasonNumber, epIndex) {
  h.iina._emit("fileChanged", { url });
  await settle();
  h.global.pickItem(item);
  await settle();
  h.global.pickSeason(seasonNumber);
  await settle();
  h.global.pickEp(epIndex);
  await settle();
}

// ── A cour folder whose filenames name no show TMDB has ─────────────
// The case pinning exists for, and the one that was falling through: the
// walk finds "Bleach TYBW The Calamity", the filename supplies a title of its
// own, and the pick was thrown away with the folder it belonged to.
const BLEACH_DIR = "file:///Volumes/Transcend/watching/anime/Bleach%20TYBW%20The%20Calamity";
const BLEACH_FILE = BLEACH_DIR + "/AnimePahe_Bleach_-_Sennen_Kessen-hen_-_41_1080p_Disney_Plus.mp4";

const BLEACH = {
  id: 30984,
  name: "Bleach",
  poster_path: "/b.jpg",
  vote_average: 8.6,
  number_of_seasons: 3,
  number_of_episodes: 420,
  // The show as TMDB files it: season 1 is the 2004 series, 366 episodes long,
  // and season 2 is Thousand-Year Blood War with 50. That is the trap the cour
  // files fall into — "… - 42" reads as season 1 episode 42, and an episode 42
  // exists there, so nothing about a fallback ever fires.
  seasons: [{ season_number: 1, episode_count: 366 }, { season_number: 2, episode_count: 50 }],
  images: { logos: [] }
};
function bleachSeason(n) {
  var eps = [], to = n === 1 ? 366 : 50;
  for (var i = 1; i <= to; i++) eps.push({ episode_number: i, name: "Ep " + i, air_date: "2026-07-25" });
  return { poster_path: "/s" + n + ".jpg", episodes: eps };
}
const BLEACH_ROUTES = {
  "/3/tv/30984/season/1": bleachSeason(1),
  "/3/tv/30984/season/2": bleachSeason(2),
  "/3/tv/30984": BLEACH
};

// What the cour test above writes, for the tests that need one to start from.
function pinnedCour(over = {}) {
  return boot({
    routes: { ...BLEACH_ROUTES, ...(over.routes || {}) },
    storage: {
      ...KEY,
      epinfo_folder_map: JSON.stringify({
        "Bleach TYBW The Calamity": { tmdbId: "30984", name: "Bleach", season: 2, lastSeen: Date.now() }
      }),
      ...(over.storage || {})
    }
  });
}

// ── A recut, whose season is numbered by the source's own counters ───
// TMDB 336584: 36 seasons, 473 episodes, and season 36 ("Egghead") carries the
// 22 recut episodes under the numbers the fansub writes in the filename. The
// source itself numbers the same episodes 1069 and up — past every episode
// TMDB lists for the show — so the arithmetic can place the season but never
// the episode.
const ONE_PACE_DIR = "file:///Volumes/Transcend/watching/anime/one pace/36";
const ONE_PACE_FILE = ONE_PACE_DIR +
  "/[One Pace][1071-1072] Egghead 09 [1080p][En Sub][BD6C0767].mp4";

const ONE_PACE = {
  id: 336584,
  name: "One Pace",
  poster_path: "/op.jpg",
  vote_average: 8.4,
  number_of_seasons: 36,
  number_of_episodes: 473,
  seasons: (function () {
    var out = [];
    for (var i = 1; i <= 35; i++) out.push({ season_number: i, episode_count: i === 35 ? 62 : 13 });
    out.push({ season_number: 36, episode_count: 22 });
    return out;
  })(),
  images: { logos: [] }
};
const ONE_PACE_ROUTES = {
  "/3/tv/336584/season/36": (function () {
    var eps = [];
    for (var i = 1; i <= 22; i++) eps.push({ episode_number: i, name: "Egghead " + i, air_date: "" });
    return { poster_path: "/s36.jpg", episodes: eps };
  })(),
  "/3/tv/336584": ONE_PACE,
  "/3/search/tv": (function () {
    return { results: [{ id: 336584, name: "One Pace", vote_count: 900, poster_path: "/op.jpg" }] };
  })()
};

// The pin the pick of one episode writes for the folder it is in.
function pinnedRecut(over = {}) {
  return boot({
    routes: { ...ONE_PACE_ROUTES, ...(over.routes || {}) },
    storage: {
      ...KEY,
      epinfo_folder_map: JSON.stringify({
        "one pace": { tmdbId: "336584", name: "One Pace", season: 36, lastSeen: Date.now() }
      }),
      ...(over.storage || {})
    }
  });
}

const FIGHT_CLUB_RESULTS = {  results: [{ id: 550, media_type: "movie", title: "Fight Club", release_date: "1999-10-15", vote_count: 27000, poster_path: "/fc.jpg" }]
};
const FIGHT_CLUB_DETAIL = {
  id: 550, title: "Fight Club", release_date: "1999-10-15", vote_average: 8.4,
  overview: "o", poster_path: "/fc.jpg", images: {}
};

// ── Writing ─────────────────────────────────────────────────────────

test("a manual pick pins the folder to the show", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  // A filename the parser cannot make sense of, which is the case pinning is
  // for. "Egghead" is what the parser would otherwise have searched.
  await manualPick(h, LIB + "/11.mkv");
  assert.ok(selected(h), "the manual pick did not take");

  const pins = folderMap(h);
  const keys = Object.keys(pins);
  assert.equal(keys.length, 1, `expected one pin, got ${JSON.stringify(pins)}`);
  assert.equal(keys[0], "samurai champloo", "pinned the wrong directory");
  assert.equal(pins["samurai champloo"].tmdbId, "1399");
  assert.equal(pins["samurai champloo"].name, "Severance");
});

test("an automatic match never writes a pin", async () => {
  // Otherwise one bad guess would silently apply to every other file.
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  const url = "file:///Users/me/Videos/Severance S01E01.mkv";
  h.global.currentVideoUrl = url;
  h.global.autoIdentify(url);
  await settle();
  assert.ok(selected(h), "auto-identification did not happen");
  assert.deepEqual(folderMap(h), {}, "an automatic match wrote a pin");
});

test("turning the opt-out off stops pins being written", async () => {
  const h = boot({ storage: { epinfo_pin_remember: "false" }, routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  assert.ok(selected(h), "the manual pick did not take");
  assert.deepEqual(folderMap(h), {}, "a pin was written despite the opt-out");
});

test("a film is not pinned", async () => {
  // A film folder would need the year to stay unambiguous against remakes.
  const h = boot();
  h.iina._emit("fileChanged", { url: LIB + "/11.mkv" });
  await settle();
  h.global.pickItem({ id: 550, media_type: "movie", title: "Fight Club" });
  await settle();
  assert.deepEqual(folderMap(h), {}, "a film was pinned");
});

test("a filename that supplied its own title is not pinned", async () => {
  // In a flat library the parent directory is usually the whole media folder,
  // and pinning that to one show would be wrong.
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, "file:///Users/me/Videos/Severance S01E01.mkv");
  assert.ok(selected(h), "the manual pick did not take");
  assert.deepEqual(folderMap(h), {}, "a flat library directory was pinned");
});

test("a pick the filename did not name pins the folder the walk found", async () => {
  // "AnimePahe Bleach - Sennen Kessen-hen - 41" names no show TMDB has, so the
  // folder beside it is the only thing that named one. Without the pin, every
  // episode of the cour costs the whole search again.
  const h = boot({ routes: BLEACH_ROUTES });
  await manualPickShow(h, BLEACH_FILE, { id: 30984, media_type: "tv", name: "Bleach" }, 2, 40);
  assert.ok(selected(h), "the manual pick did not take");
  assert.equal(selected(h).code, "S02E41");

  const pins = folderMap(h);
  assert.deepEqual(Object.keys(pins), ["Bleach TYBW The Calamity"],
    `expected the cour folder, got ${JSON.stringify(pins)}`);
  assert.equal(pins["Bleach TYBW The Calamity"].tmdbId, "30984");
  assert.equal(pins["Bleach TYBW The Calamity"].season, 2);
});

test("a pick the filename did name pins nothing, however good the folder looks", async () => {
  // The guard, with a directory the walk is happy to name: the filename
  // already carried the show, so the folder above it is the media folder as
  // often as it is the show's own.
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, "file:///Users/me/Stuff/Severance S01E01.mkv");
  assert.ok(selected(h), "the manual pick did not take");
  assert.deepEqual(folderMap(h), {}, "a directory the filename did not need was pinned");
});

// ── Reading ─────────────────────────────────────────────────────────

test("a pick carries to the other files in the same cour", async () => {
  // The whole point, on the folder that started it. "… - 42" reads as season 1
  // episode 42, and season 1 of this show *has* an episode 42 — the 2004
  // series' one. Only the season the pick was made in puts the number where it
  // belongs, and without it the plugin saved that other episode.
  const h = boot({ routes: BLEACH_ROUTES });
  await manualPickShow(h, BLEACH_FILE, { id: 30984, media_type: "tv", name: "Bleach" }, 2, 40);
  assert.equal(selected(h).code, "S02E41");

  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url: BLEACH_FILE.replace("_-_41_", "_-_42_") });
  await settle();
  assert.equal(selected(h).code, "S02E42", "the next file did not follow");

  // Beside the pick (S02E42) the entry records what the filename claimed
  // (season 1, episode 42), which is what keeps the next replay from calling
  // the season a stale entry.
  const entry = JSON.parse(h.localStorage.getItem("epinfo_url_map"))[BLEACH_FILE.replace("_-_41_", "_-_42_")];
  assert.equal(entry.parsedSeason, 1);
  assert.equal(entry.parsedEpisode, 42);

  h.iina._emit("fileChanged", { url: BLEACH_FILE.replace("_-_41_", "_-_43_") });
  await settle();
  assert.equal(selected(h).code, "S02E43");

  // No search at any point: the pin names the show, and its season puts the
  // number back where it belongs.
  assert.deepEqual(searchedQueries(h.fetchCalls.slice(before)).filter(Boolean), [],
    "a pinned folder fell back to searching");
});

test("a number no season holds is left to the user", async () => {
  // The fallback is not a promise: with the number in neither season — here
  // the assumed season is 366 episodes long and still has no 999 — the pills
  // stay up, on the season the folder remembers, and nothing is saved.
  const h = pinnedCour();
  h.iina._emit("fileChanged", { url: BLEACH_FILE.replace("_-_41_", "_-_999_") });
  await settle();

  assert.equal(selected(h), null, "an episode that exists in no season was saved");
  const ep = h.document.getElementById("ep").innerHTML;
  assert.match(ep, /no episode 999 in season 2/, ep);
  // The panel stays on the season the folder remembers: the second look is
  // silent, and it must not repaint the season it passed through.
  assert.match(h.document.getElementById("panel").innerHTML,
    /class="pill on" onclick="pickSeason\(2\)"/, "the season pills did not stay on the folder's season");
});

test("a season the filename stated outranks the folder's memory", async () => {
  // "S01E05" says which season it is. The pin remembers season 2 from the
  // user's last pick in the folder, and must not drag the file there.
  const h = pinnedCour();
  h.iina._emit("fileChanged", { url: BLEACH_DIR + "/Bleach.S01E05.1080p.mkv" });
  await settle();
  assert.equal(selected(h).code, "S01E05");
});

test("an episode saved under the season the folder disagrees with is rebuilt", async () => {
  // What the files looked like before the folder's season was used: 42 saved
  // as the 2004 series' episode 42, under a season the pin says is 2. The
  // entry cannot notice that on its own — the number is in both seasons — so
  // the folder's own answer retires it.
  const h = pinnedCour();
  const url = BLEACH_FILE.replace("_-_41_", "_-_42_");
  h.localStorage.setItem("epinfo_url_map", JSON.stringify({
    [url]: {
      showTitle: "Bleach", epTitle: "Ep 42", code: "S01E42", season: 1, episode: 42,
      tmdbId: "30984", isMovie: false, logoUrl: "", context: "", absoluteFrom: null,
      parsedSeason: 1, parsedEpisode: 42, lastSeen: Date.now()
    }
  }));

  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(selected(h).code, "S02E42", "the entry was not rebuilt from the folder's season");

  // …and only once: the rebuilt entry agrees with the folder, so the next
  // return is a restore.
  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.fetchCalls.length, before, "the rebuilt entry was rebuilt again");
  assert.equal(selected(h).code, "S02E42");
});

test("a recut's counter places the episode in the season the folder remembers", async () => {
  // The source numbers these 1069 and up, past every episode TMDB lists for
  // the show, so the arithmetic can place season 36 and no episode of it. The
  // filename's own counter is the number season 36 is actually numbered by —
  // and the pin is what says so, which is why one pick per folder is enough.
  const h = pinnedRecut();
  h.iina._emit("fileChanged", { url: ONE_PACE_FILE });
  await settle();

  const info = selected(h);
  assert.ok(info, "the episode was not selected");
  assert.equal(info.code, "S36E09");
  assert.equal(info.showTitle, "One Pace");
  // The entry records the absolute number it was built from, as every entry
  // built from one does.
  const entry = JSON.parse(h.localStorage.getItem("epinfo_url_map"))[ONE_PACE_FILE];
  assert.equal(entry.absoluteFrom, 1071);
});

test("without a pin, a recut's counter is not guessed at", async () => {
  // The counter means nothing against the series a recut re-cuts: "Egghead 09"
  // is not episode 9 of the original run. The season is all that can be known,
  // so the pills are left for the user.
  const h = boot({ routes: ONE_PACE_ROUTES });
  h.iina._emit("fileChanged", { url: ONE_PACE_FILE });
  await settle();

  assert.equal(selected(h), null, "an episode was invented from the counter");
  assert.match(h.document.getElementById("panel").innerHTML, /pickSeason\(36\)/,
    "the picker should be left on the season the arithmetic found");
});

test("a film in a pinned folder is identified as a film", async () => {
  // A pin names a series, and a folder can hold films beside its episodes —
  // the watching root, or a series folder someone dropped a film into. They
  // must not be read as episodes of whatever series was picked there.
  const h = pinnedCour({ routes: { "/3/search/movie": FIGHT_CLUB_RESULTS, "/3/movie/550": FIGHT_CLUB_DETAIL } });
  h.iina._emit("fileChanged", { url: BLEACH_DIR + "/Fight%20Club%201999%201080p%20BluRay%20x264-GRP.mkv" });
  await settle();

  const info = selected(h);
  assert.ok(info, "the film was not identified");
  assert.equal(info.isMovie, true);
  assert.equal(info.epTitle, "Fight Club");
  assert.equal(h.fetchCalls.filter((u) => u.includes("/3/tv/")).length, 0,
    "the film was asked as a series");

  // …and the pin is untouched for the folder's episodes, season and all.
  h.iina._emit("fileChanged", { url: BLEACH_FILE.replace("_-_41_", "_-_42_") });
  await settle();
  assert.equal(selected(h).code, "S02E42");
});

test("a later file in a pinned folder resolves with no search at all", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  assert.ok(selected(h));

  // A different file, and a name the parser could never have resolved. Only
  // the requests made *after* the pin matters: the first file legitimately
  // searched, because at that point nothing was pinned.
  const before = h.fetchCalls.length;
  const next = LIB + "/AnimePahe_Egghead_-_12_1080p.mkv";
  h.iina._emit("fileChanged", { url: next });
  await settle();

  const info = selected(h);
  assert.ok(info, "the pinned folder did not resolve");
  assert.equal(info.showTitle, "Severance");

  const after = h.fetchCalls.slice(before);
  assert.deepEqual(searchedQueries(after).filter(Boolean), [], "the pin fell through to searching");
  // The show and its season, and nothing else.
  assert.equal(after.length, 2, `unexpected requests: ${after}`);
  assert.ok(after[0].includes("/3/tv/1399?"), after[0]);
});

test("a pin reaches into subdirectories", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  const picksBefore = h.iina._posted.filter((x) => x.name === "episodeSelected").length;
  h.iina._emit("fileChanged", { url: LIB + "/Season%202/03.mkv" });
  await settle();
  const picks = h.iina._posted.filter((x) => x.name === "episodeSelected");
  assert.equal(picks.length, picksBefore + 1, "a file inside Season 2 did not resolve");
  assert.equal(picks[picks.length - 1].payload.showTitle, "Severance");
  // The pin names the show; the "Season 2" directory and the bare "03" still
  // decide the episode. The pin's own remembered season is 1, from the pick
  // above, and must not drag the file back there.
  assert.equal(picks[picks.length - 1].payload.code, "S02E03");
});

test("a pinned folder with an unreadable name still yields the show", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  const url = LIB + "/[SomeFansub][1-2] Whatever 04 [1080p][FD5592BE].mkv";
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(selected(h).showTitle, "Severance");
});

test("unpinning stops the folder resolving", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  assert.ok(folderMap(h)["samurai champloo"]);

  h.global.doUnpinFolder();
  assert.deepEqual(folderMap(h), {}, "the pin survived");

  // The same unreadable file now finds nothing, because the search route in
  // this harness returns no results. Compare post counts, not the last
  // payload, or the earlier pick would mask the failure.
  const picksBefore = h.iina._posted.filter((x) => x.name === "episodeSelected").length;
  h.iina._emit("fileChanged", { url: LIB + "/AnimePahe_Egghead_-_12_1080p.mkv" });
  await settle();
  const picksAfter = h.iina._posted.filter((x) => x.name === "episodeSelected").length;
  assert.equal(picksAfter, picksBefore, "an unpinned folder still resolved");
});

test("a pin is refreshed when used, so a live library never ages out", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  const stale = Date.now() - 200 * 86400000;   // 200 days ago
  const m = folderMap(h);
  m["samurai champloo"].lastSeen = stale;
  h.localStorage.setItem("epinfo_folder_map", JSON.stringify(m));

  // Using the folder refreshes the stamp, which is what keeps it alive.
  h.iina._emit("fileChanged", { url: LIB + "/12.mkv" });
  await settle();
  assert.ok(folderMap(h)["samurai champloo"].lastSeen > stale,
    "the pin was not refreshed by being used");
  assert.equal(h.global.pruneFolderMap(), 0, "a freshly used pin aged out anyway");
});

test("a folder that has not been touched does age out", async () => {
  const h = boot({ routes: { "/3/search/tv": SEVERANCE_RESULTS } });
  await manualPick(h, LIB + "/11.mkv");
  const m = folderMap(h);
  m["samurai champloo"].lastSeen = Date.now() - 200 * 86400000;
  h.localStorage.setItem("epinfo_folder_map", JSON.stringify(m));

  const dropped = h.global.pruneFolderMap();
  assert.equal(dropped, 1);
  assert.deepEqual(folderMap(h), {});
});
// ── Both maps age out at launch ────────────────────────────────────

test("the boot pass ages out a stale folder pin", async () => {
  // pruneFolderMap existed and was tested in isolation, but nothing called it:
  // the boot block only ran pruneUrlMap, so folder pins were the one map that
  // only ever grew.
  const stale = Date.now() - 200 * 86400000;
  const h = loadSidebar({
    storage: {
      epinfo_tmdb_key: "K",
      epinfo_folder_map: JSON.stringify({
        "samurai champloo": { tmdbId: "1399", name: "Severance", season: 1, lastSeen: stale }
      }),
      epinfo_url_map: JSON.stringify({
        "file:///v/old.mkv": { showTitle: "Severance", season: 1, episode: 1, lastSeen: stale }
      })
    },
    routes: {}
  });
  assert.equal(Object.keys(folderMap(h)).length, 1, "the fixture did not seed");

  // The boot block is a timer; fire it.
  h.timers._fireAll();
  await settle();

  assert.deepEqual(folderMap(h), {}, "a stale folder pin survived the boot pass");
  assert.deepEqual(urlMap(h), {}, "a stale URL entry survived the boot pass");
});

test("a fresh pin survives the boot pass", () => {
  const h = loadSidebar({
    storage: {
      epinfo_tmdb_key: "K",
      epinfo_folder_map: JSON.stringify({
        "samurai champloo": { tmdbId: "1399", name: "Severance", season: 1, lastSeen: Date.now() }
      })
    },
    routes: {}
  });
  h.timers._fireAll();
  assert.equal(Object.keys(folderMap(h)).length, 1, "the boot pass dropped a live pin");
});

test("a manual pick on an unparseable file does not pin the last parsed folder", async () => {
  // currentParsed was never cleared, so a parse that failed left the previous
  // file's titleDir standing and the pin writer read it: picking a show by
  // hand for "Episode 3.mkv" pinned the folder of whatever was parsed last,
  // and every file in that folder was then identified as the picked show.
  const h = boot();
  h.global.parseFilename("file:///Users/me/Videos/Severance/Season 1/05.mkv");
  assert.equal(h.global.currentParsed.titleDir, "Severance", "fixture did not parse");

  const url = "file:///Users/me/Videos/Episode 3.mkv";
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.global.currentParsed, null, "the failed parse kept the previous file's state");

  // The user identifies the unparseable file by hand.
  h.global.selShow = { id: 999, name: "Wrong Show", poster_path: "" };
  h.global.selSeason = 1;
  h.global.episodeCache = [{ episode_number: 1, name: "Pilot" }];
  h.global.pickEp(0, false);

  assert.deepEqual(folderMap(h), {}, "a folder was pinned from a stale parse");
});
