import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, settle, searchedQueries, requestedPaths } from "./helpers/harness.mjs";

const KEY = { epinfo_tmdb_key: "TESTKEY" };

const SHOW = {
  id: 1399,
  name: "Severance",
  poster_path: "/p.jpg",
  seasons: [{ season_number: 1 }, { season_number: 2 }],
  images: { logos: [{ file_path: "/logo.jpg", aspect_ratio: 6, iso_639_1: "en" }] }
};

const SEASON_2 = {
  poster_path: "/s2.jpg",
  episodes: [
    { episode_number: 1, name: "Hello, Ms. Cobel", air_date: "2025-02-21", vote_average: 8.4, overview: "o1" },
    { episode_number: 2, name: "Half Loop", air_date: "2025-02-28", vote_average: 8.8, overview: "o2" },
    { episode_number: 3, name: "In Perpetuity", air_date: "2025-03-07", vote_average: 9.1, overview: "o3" }
  ]
};

function routes(overrides = {}) {
  return {
    "/3/search/tv": { results: [{ id: 1399, name: "Severance", vote_count: 4000, poster_path: "/p.jpg" }] },
    "/3/search/movie": { results: [] },
    "/3/tv/1399/season/2": SEASON_2,
    "/3/tv/1399/season/1": { poster_path: "/s1.jpg", episodes: [] },
    "/3/tv/1399": SHOW,
    "/3/movie/550": { title: "Fight Club", release_date: "1999-10-15", vote_average: 8.4, overview: "o", poster_path: "/fc.jpg", images: {} },
    ...overrides
  };
}

function boot(opts = {}) {
  const h = loadSidebar({ storage: KEY, routes: routes(opts.routes) });
  return h;
}

// Drive one file through the whole identification path the way main.js does.
async function identify(h, url) {
  h.global.currentVideoUrl = url;
  const started = h.global.autoIdentify(url);
  await settle();
  return started;
}

function episodeSelected(h) {
  const posted = h.iina._posted.filter((p) => p.name === "episodeSelected");
  return posted.length ? posted[posted.length - 1].payload : null;
}

test("identifies a release filename with no user interaction", async () => {
  const h = boot();
  const started = await identify(h, "file:///Users/me/Videos/Severance.S02E03.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv");
  assert.equal(started, true);

  const info = episodeSelected(h);
  assert.ok(info, "nothing was selected");
  assert.equal(info.showTitle, "Severance");
  assert.equal(info.code, "S02E03");
  assert.equal(info.epTitle, "In Perpetuity");
  assert.equal(info.airDate, "2025-03-07");
  assert.equal(info.logoUrl, "https://image.tmdb.org/t/p/w780/logo.jpg");
});

test("searches the parsed title, not the whole filename", async () => {
  const h = boot();
  await identify(h, "file:///Users/me/Videos/Severance.S02E03.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv");
  assert.deepEqual(searchedQueries(h.fetchCalls).filter(Boolean), ["Severance"]);
});

test("a release-group suffix TMDB missed once is not asked again for the next episode", async () => {
  // Every file in a batch carries the same release-group suffix, so without
  // the session miss memory each new episode spent its first round trip
  // re-learning that the suffix is noise.
  const h = boot({
    routes: {
      "/3/search/tv": (url) =>
        decodeURIComponent(url).includes("Severance BluMovie")
          ? { results: [] }
          : { results: [{ id: 1399, name: "Severance", vote_count: 4000 }] }
    }
  });
  await identify(h, "file:///v/Severance.1080p.BluMovie.S02E01.mkv");
  assert.equal(episodeSelected(h).code, "S02E01");
  const firstQueries = searchedQueries(h.fetchCalls).filter(Boolean);
  assert.deepEqual(firstQueries, ["Severance BluMovie", "Severance"],
    `the first identification did not walk the ladder: ${JSON.stringify(firstQueries)}`);

  const before = h.fetchCalls.length;
  await identify(h, "file:///v/Severance.1080p.BluMovie.S02E02.mkv");
  assert.equal(episodeSelected(h).code, "S02E02");
  const secondQueries = searchedQueries(h.fetchCalls.slice(before)).filter(Boolean);
  assert.deepEqual(secondQueries, ["Severance"],
    `the missed candidate cost a request again: ${JSON.stringify(secondQueries)}`);
});

test("a film is identified by year, and a remake loses", async () => {
  const h = boot({
    routes: {
      "/3/search/movie": {
        results: [
          { id: 134, title: "Footloose", release_date: "2011-10-14", vote_count: 5000 },
          { id: 900, title: "Footloose", release_date: "1984-02-17", vote_count: 900 }
        ]
      },
      "/3/movie/900": { title: "Footloose", release_date: "1984-02-17", vote_average: 6.2, images: {} }
    }
  });
  await identify(h, "file:///Users/me/Videos/Footloose.1984.1080p.mkv");
  const info = episodeSelected(h);
  assert.ok(info, "no film was selected");
  assert.equal(info.isMovie, true);
  assert.equal(info.epTitle, "Footloose");
  assert.equal(info.airDate, "1984-02-17");
});

test("a name with neither an episode code nor a year is left alone", async () => {
  const h = boot();
  const started = await identify(h, "file:///Users/me/Videos/Some Random Home Video.mp4");
  assert.equal(started, false);
  assert.equal(h.fetchCalls.length, 0, "a manual-only file must cost no requests");
});

test("a remembered identification is restored without any request", async () => {
  const h = boot();
  const url = "file:///Users/me/Videos/Severance.S02E03.mkv";
  await identify(h, url);
  const callsAfterFirst = h.fetchCalls.length;
  assert.ok(callsAfterFirst > 0);

  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.fetchCalls.length, callsAfterFirst, "re-opening a known file re-fetched");
  assert.equal(episodeSelected(h).code, "S02E03");
});

test("a cached entry that disagrees with the filename is re-identified", async () => {
  const h = boot();
  const url = "file:///Users/me/Videos/Severance.S02E03.mkv";
  await identify(h, url);

  // Same URL, but the entry was built from a different number: the filename is
  // ground truth, so the stale entry must be replaced rather than replayed.
  // Rewriting what the entry records the filename as having said is what makes
  // it an entry for another file — a pick the user corrected by hand leaves
  // that field alone, and is kept (see the test below).
  const map = JSON.parse(h.localStorage.getItem("epinfo_url_map"));
  map[url].episode = 1;
  map[url].code = "S02E01";
  map[url].parsedEpisode = 1;
  h.localStorage.setItem("epinfo_url_map", JSON.stringify(map));

  // Come back to the file the way a playlist does: play something else in
  // between. A repeat of fileChanged for the file already playing is now a
  // deliberate no-op, so it cannot stand in for "the user returned".
  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.ok(h.fetchCalls.length > before, "stale entry was replayed instead of re-identified");
  assert.equal(episodeSelected(h).code, "S02E03");
});

test("an entry written before the parse was recorded is re-identified once", async () => {
  const h = boot();
  const url = "file:///Users/me/Videos/Severance.S02E03.mkv";
  await identify(h, url);

  // An entry from a build that did not record the parse. It cannot be checked
  // against the file it was built from, so it is rebuilt once — exactly as an
  // entry with no absoluteFrom is.
  const map = JSON.parse(h.localStorage.getItem("epinfo_url_map"));
  delete map[url].parsedSeason;
  delete map[url].parsedEpisode;
  map[url].episode = 1;
  map[url].code = "S02E01";
  h.localStorage.setItem("epinfo_url_map", JSON.stringify(map));

  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.ok(h.fetchCalls.length > before, "an unchecked entry was replayed");
  assert.equal(episodeSelected(h).code, "S02E03", "the entry was not rebuilt");

  // And only once: the rebuilt entry records the parse, so the next return is
  // a restore rather than another round trip.
  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const after = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.fetchCalls.length, after, "the rebuilt entry was re-identified again");
  assert.equal(episodeSelected(h).code, "S02E03");
});

test("a season pack's entry is not stale for naming no episode", async () => {
  // The filename names a season and no episode, so the entry has an episode
  // number the filename does not. Comparing the two directly made the entry
  // stale on every return, because a missing episode read as zero.
  const h = boot();
  const url = "file:///Users/me/Videos/Severance.S02.COMPLETE.1080p.mkv";
  await identify(h, url);
  assert.equal(h.global.currentParsed.code.episode, null, "the fixture should name no episode");

  // What a manual pick of the first episode saves for it.
  h.global.currentVideoUrl = url;
  h.global.parseFilename(url);
  h.global.selShow = { id: 1399, name: "Severance", _name: "Severance" };
  h.global.selSeason = 2;
  h.global.episodeCache = [SEASON_2.episodes[0]];
  h.global.pickEp(0, false);
  await settle();
  assert.equal(episodeSelected(h).code, "S02E01");

  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.fetchCalls.length, before, "a season pack's own entry was re-identified");
  assert.equal(episodeSelected(h).code, "S02E01");
});

test("a season the user corrected by hand survives a replay", async () => {
  const h = boot();
  const url = "file:///Users/me/Videos/Severance.S02E03.mkv";
  await identify(h, url);

  // The pick named a different season and episode than the filename did. That
  // disagreement is the correction, not a stale entry: the comparison is
  // against what the filename claimed when the pick was made, and re-identifying
  // here rebuilt S02E03 and threw the correction away on every return.
  const map = JSON.parse(h.localStorage.getItem("epinfo_url_map"));
  map[url].season = 1;
  map[url].episode = 2;
  map[url].code = "S01E02";
  h.localStorage.setItem("epinfo_url_map", JSON.stringify(map));

  h.iina._emit("fileChanged", { url: "file:///v/Some Other Film 2019.mkv" });
  await settle();
  const before = h.fetchCalls.length;
  h.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(h.fetchCalls.length, before, "the corrected entry was re-identified");
  assert.equal(episodeSelected(h).code, "S01E02");
});

test("the episode's own title is never searched for", async () => {
  // The filename carries the episode's title after its code. Asking TMDB about
  // all of those words returned nothing at all, six times over, while the
  // show's own name — the two-word prefix — was past the ladder's budget. The
  // title stops at the code now, so the first question asked is the show.
  const h = boot({
    routes: {
      "/3/search/tv": (url) => /query=Hells%20Paradise$/.test(url)
        ? { results: [{ id: 1399, name: "Hell's Paradise", vote_count: 900, poster_path: "/hp.jpg" }] }
        : { results: [] },
      "/3/tv/1399": { id: 1399, name: "Hell's Paradise", seasons: [{ season_number: 1, episode_count: 13 }], images: {} },
      "/3/tv/1399/season/1": {
        poster_path: "",
        episodes: [{ episode_number: 1, name: "The Death Row Convict and the Executioner", air_date: "2023-04-01" }]
      }
    }
  });
  const started = await identify(h, "file:///Users/me/Videos/"
    + "Hells.Paradise.S01E01.The.Death.Row.Convict.and.the.Executioner.1080p.CR.WEB-DL.AAC2.0.H.264-HDC.mkv");
  assert.equal(started, true);

  const info = episodeSelected(h);
  assert.ok(info, "nothing was selected");
  assert.equal(info.showTitle, "Hell's Paradise");
  assert.equal(info.code, "S01E01");
  // One question, and it is the show's name.
  assert.deepEqual(searchedQueries(h.fetchCalls).filter(Boolean), ["Hells Paradise"]);
});

test("a folder-per-cour layout identifies from the directory", async () => {
  // "megalobox/1/EP.1.720p.mp4": the marker is the whole filename, so the show
  // is in the directory and the season is in the folder above the file. Both
  // were being missed — "EP 1" was searched for as a title.
  const h = boot({
    routes: {
      "/3/search/tv": (url) => /query=megalobox$/.test(url)
        ? { results: [{ id: 80787, name: "MEGALOBOX", vote_count: 300, poster_path: "/mb.jpg" }] }
        : { results: [] },
      "/3/tv/80787": {
        id: 80787, name: "MEGALOBOX",
        seasons: [{ season_number: 1, episode_count: 13 }, { season_number: 2, episode_count: 13 }],
        images: {}
      },
      "/3/tv/80787/season/1": {
        poster_path: "",
        episodes: [{ episode_number: 1, name: "Buy or Die", air_date: "2018-04-06" }]
      }
    }
  });
  const started = await identify(h, "file:///Volumes/Transcend/movies/anime/megalobox/1/EP.1.720p.mp4");
  assert.equal(started, true);

  const info = episodeSelected(h);
  assert.ok(info, "nothing was selected");
  assert.equal(info.showTitle, "MEGALOBOX");
  assert.equal(info.code, "S01E01");
  assert.deepEqual(searchedQueries(h.fetchCalls).filter(Boolean), ["megalobox"]);
});

test("every request goes to a host declared in Info.json", async () => {
  const h = boot();
  await identify(h, "file:///Users/me/Videos/Severance.S02E03.mkv");
  for (const path of requestedPaths(h.fetchCalls)) {
    assert.match(path, /^\/3\//, `unexpected request path: ${path}`);
  }
});
test("a film is chosen by how well its name matches, not by votes alone", async () => {
  // Sorting a film on votes and the year picked "Star Wars" for
  // "Star.Wars.Episode.IV.-.A.New.Hope.1977": both are 1977, and the shorter
  // title has more votes. The name has to be the first thing ranked on.
  const h = boot({
    routes: {
      "/3/search/movie": {
        results: [
          { id: 1, title: "Star Wars", release_date: "1977-05-25", vote_count: 20000 },
          { id: 2, title: "Star Wars: Episode IV - A New Hope", release_date: "1977-05-25", vote_count: 12000 }
        ]
      },
      "/3/movie/2": {
        title: "Star Wars: Episode IV - A New Hope", release_date: "1977-05-25", images: {}
      }
    }
  });
  await identify(h, "file:///Users/me/Videos/Star.Wars.Episode.IV.-.A.New.Hope.1977.1080p.BluRay.x264-SPARKS.mkv");
  const info = episodeSelected(h);
  assert.ok(info, "no film was selected");
  assert.equal(info.epTitle, "Star Wars: Episode IV - A New Hope",
    "the higher-voted title won despite matching the name less well");
});

// ── An errored lookup is not an unrecognised filename ────────────────────

test("a rate-limited TMDB is reported as a failed lookup, not as no match", async () => {
  // A rate-limited TMDB resolves with a body carrying status_code and no
  // results array. Reading that as "no matches" blamed the filename for a
  // transient failure, and then spent every remaining candidate asking the
  // same refused question, which made the limit worse for the next file too.
  const h = boot({
    routes: {
      "/3/search/movie": { status_code: 25, status_message: "Rate limit exceeded" },
      "/3/search/tv": { status_code: 25, status_message: "Rate limit exceeded" }
    }
  });
  await identify(h, "file:///Users/me/Videos/Decision.To.Leave.2022.1080p.Korean.WEB-DL.HEVC.x265-GROUP.mkv");
  const panel = h.document.getElementById("panel").innerHTML;
  assert.doesNotMatch(panel, /No match for/,
    "a TMDB error was reported as an unrecognised filename");
  assert.match(panel, /Lookup failed/, `panel did not say the lookup failed: ${panel}`);
  assert.equal(searchedQueries(h.fetchCalls).filter(Boolean).length, 1,
    "the ladder kept spending requests after TMDB had already refused");
});

test("an errored lookup names no title and selects nothing", async () => {
  const h = boot({
    routes: {
      "/3/search/tv": { status_code: 25, status_message: "Rate limit exceeded" },
      "/3/search/movie": { status_code: 25, status_message: "Rate limit exceeded" }
    }
  });
  await identify(h, "file:///Users/me/Videos/Severance.S02E03.mkv");
  assert.equal(episodeSelected(h), null, "something was selected from an error body");
});

test("a film the ladder will not auto-accept is offered as a pickable row", async () => {
  // TMDB files a same-titled 2021 film above the real 2022 one, so the year
  // gate refuses the top hit and the ladder runs out of candidates. The
  // results it already had are exactly what the user needs, and they were being
  // thrown away in favour of "search above".
  const h = boot({
    routes: {
      "/3/search/movie": {
        results: [
          { id: 1, title: "Decision to Leave", release_date: "2021-03-05", vote_count: 900 },
          { id: 2, title: "Leaving", release_date: "2022-06-24", vote_count: 4000 }
        ]
      },
      "/3/movie/1": { id: 1, title: "Decision to Leave", release_date: "2021-03-05",
                      vote_average: 6.1, overview: "", poster_path: "/a.jpg", images: {} },
      "/3/movie/2": { id: 2, title: "Decision to Leave", release_date: "2022-06-24",
                      vote_average: 8.0, overview: "", poster_path: "/b.jpg", images: {} }
    }
  });
  await identify(h, "file:///Users/me/Videos/Decision.To.Leave.2022.1080p.Korean.WEB-DL.HEVC.x265-GROUP.mkv");

  const panel = h.document.getElementById("panel").innerHTML;
  assert.match(panel, /pickItemByIndex/, `the results were discarded: ${panel}`);
  assert.equal(episodeSelected(h), null, "the year gate said no, so nothing was auto-chosen");

  // And the right one is a single click away.
  h.global.pickItemByIndex(1);
  await settle();
  const info = episodeSelected(h);
  assert.ok(info, "picking a suggestion selected nothing");
  assert.match(info.airDate, /^2022/, `picked the wrong film: ${info.airDate}`);
});

test("a failed lookup offers no rows, because it has none to offer", async () => {
  // The suggestions must not paper over a rate limit: there were no results,
  // so a list of rows would be a different lie.
  const h = boot({
    routes: {
      "/3/search/tv": { status_code: 25, status_message: "Rate limit exceeded" },
      "/3/search/movie": { status_code: 25, status_message: "Rate limit exceeded" }
    }
  });
  await identify(h, "file:///Users/me/Videos/Decision.To.Leave.2022.1080p.mkv");
  const panel = h.document.getElementById("panel").innerHTML;
  assert.doesNotMatch(panel, /pickItemByIndex/, "rows offered with no results behind them");
  assert.match(panel, /Lookup failed/);
});

test("a series miss does not block the same name's film search", async () => {
  // The miss memory was keyed on the query alone, so "Foo" having no series
  // skipped the /search/movie call for a film called Foo within the same
  // session: zero film requests and "No match" for a film TMDB held.
  const h = boot({
    routes: {
      "/3/search/tv": { results: [] },
      "/3/search/movie": { results: [{ id: 550, title: "Foo", release_date: "2019-05-05", vote_count: 900 }] },
      "/3/movie/550": { title: "Foo", release_date: "2019-05-05", vote_average: 8, images: {}, overview: "" }
    }
  });
  await identify(h, "file:///v/Foo.S01E01.mkv");   // the series miss
  await identify(h, "file:///v/Foo.2019.mkv");     // same name, a film

  const info = episodeSelected(h);
  assert.ok(info, "the film was never identified");
  assert.equal(info.isMovie, true);
  assert.equal(info.epTitle, "Foo");
});
