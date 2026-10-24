// Regressions found by the second audit, all of them introduced by fixes to
// earlier bugs. Each one was a real filename of the kind users have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, settle, searchedQueries } from "./helpers/harness.mjs";

const h = loadSidebar();
const KEY = { epinfo_tmdb_key: "TESTKEY" };
const { parseFilename, cleanTitle, stripTrailingJunk } = h.global;

function at(dir, file) {
  return "file:///Users/me/Videos/" + (dir ? dir + "/" : "") + file;
}
function parse(url) { return parseFilename(url); }

// ── Scene names written with underscores ────────────────────────────

// ── One Piece, for the absolute-numbering cases ──────────────────────
// The real filename that started all of this, and the show TMDB files it
// under. Note the fansub calls itself "One Pace" and the series is "One Piece".
const FANSUB = "[One Pace][1062-1063] Egghead 04 [1080p][En Sub][FD5592BE].mp4";

// Seasons sized so the cumulative mapping is verifiable by hand: twenty seasons
// of 50 put the running total at exactly 1000, so absolute 1062 lands on season
// 21 episode 62. All 21 are listed because the mapping adds them up in order,
// so a gap would throw the total off.
const ONE_PIECE = (() => {
  const seasons = [];
  for (let i = 1; i <= 20; i++) seasons.push({ season_number: i, episode_count: 50 });
  seasons.push({ season_number: 21, episode_count: 100 });
  return {
    id: 37854,
    name: "One Piece",
    poster_path: "/op.jpg",
    number_of_seasons: 21,
    number_of_episodes: 1100,
    seasons,
    images: { logos: [{ file_path: "/op-logo.png", aspect_ratio: 3.4, iso_639_1: "en" }] }
  };
})();
const ONE_PIECE_RESULTS = {
  results: [{ id: 37854, name: "One Piece", vote_count: 4000, poster_path: "/op.jpg" }]
};

// Two boots, because the two halves of this file need different things: the
// parse checks share one pure context, the end-to-end checks need TMDB routes.
function boot(routes = {}) {
  return loadSidebar({
    storage: KEY,
    routes: {
      "/3/search/tv": { results: [] },
      "/3/search/multi": { results: [] },
      "/3/tv/37854/season/1": {
        poster_path: "",
        episodes: [
          { episode_number: 1, name: "I'm Luffy!", air_date: "1999-10-20" },
          { episode_number: 62, name: "Now Stand Up!", air_date: "2001-02-06" }
        ]
      },
      "/3/tv/37854/season/20": {
        poster_path: "", episodes: [{ episode_number: 1, name: "The Very, Very, Very Strongest Sea Punk" }]
      },
      "/3/tv/37854/season/21": {
        poster_path: "",
        episodes: [
          { episode_number: 62, name: "The Very, Very, Very Strongest Sea Punk", air_date: "2025-12-07" }
        ]
      },
      "/3/tv/37854": ONE_PIECE,
      ...routes
    }
  });
}
async function identify(app, url) {
  app.global.currentVideoUrl = url;
  app.global.autoIdentify(url);
  await settle();
}
function selected(app) {
  const p = app.iina._posted.filter((x) => x.name === "episodeSelected");
  return p.length ? p[p.length - 1].payload : null;
}

test("an underscore between title and code does not hide the code", () => {
  // \b cannot match between "_" and "S", so every scene-style name fell through
  // to the bare-number pattern. On "DDP5_1" that pattern matched "_1_", and
  // the episode was reported as 1 for every file in the library.
  const p = parse(at("", "The_Mandalorian_S02E05_1080p_DISNEY+_WEB-DL_DDP5_1_atmos_H264-GROUP.mkv"));
  assert.deepEqual([p.code.season, p.code.episode], [2, 5]);
  // The streaming service is noise; it used to stay in the title and cost an
  // extra TMDB query on every scene release.
  assert.equal(p.title, "The Mandalorian");
});

test("an underscore after the code does not hide it either", () => {
  for (const [name, want] of [
    ["Severance_S02E06_1080p_WEB-DL_DDP5_1_H264-NTb.mkv", [2, 6]],
    ["The_Bear_S03E09_1080p_HULU_WEB-DL_DDP5_1_H264-NTb.mkv", [3, 9]],
    ["The_Office_US_S03E12_1080p_WEB-DL_DDP5_1_x264-NTb.mkv", [3, 12]],
    ["Band_of_Brothers_S01E04_720p_HDTV_x264-KILLERS.mkv", [1, 4]],
    ["Rick_and_Morty_S06E03_1080p_AMZN_WEB-DL_DDP5_1_H264-NTb.mkv", [6, 3]]
  ]) {
    const p = parse(at("", name));
    assert.deepEqual([p.code && p.code.season, p.code && p.code.episode], want, name);
  }
});

test("a trailing underscore in an anime name still gives the episode", () => {
  const p = parse(at("", "AnimePahe_Nippon_Sangoku_-_05_1080p_Amazon.mkv"));
  assert.equal(p.code.episode, 5);
});

test("a codec chain joined with underscores is not an episode number", () => {
  // "DDP5_1" ends in "_1_", which the mid-string number pattern matches
  // exactly. A number only counts when it starts a fresh token.
  const p = parse(at("", "Some.Show.05.DDP5_1.x264.mkv"));
  assert.equal(p.code.episode, 5);
  // Nothing to identify: a filename that is only a codec tag has no subject,
  // and inventing episode 1 for it is what this guard prevents.
  assert.equal(parse(at("", "DDP5_1.mkv")), null);
  // The guard is about a token starting there, not about the separators: a
  // number that follows a letter is a version, not an episode.
  const version = parse(at("", "Show.Name.v2_1080p.mkv"));
  assert.equal(version.code, null);
  // …and the first digit group in the name is not automatically the episode
  // either. "H264_2" is the tail of a codec tag, and matching it left the real
  // number further along unread, so this reported episode 2.
  const later = parse(at("", "Show_H264_2_Name_05.mkv"));
  assert.equal(later.code.episode, 5);
});

// ── A bracketed resolution is not an absolute episode ───────────────

test("a bare [1080] or [2160] is a resolution, not episode 1080", () => {
  // Reading it as an absolute number invented episode 1080 and, because an
  // absolute number suppresses the filename's own code, lost S01E05 too.
  for (const name of [
    "Show.S01E05.[1080].mkv",
    "Show Name [1080] S01E02.mkv",
    "[Group][Show Name][01][1080].mkv",
    "Show [2160].mkv"
  ]) {
    const p = parse(at("", name));
    assert.equal(p.absolute, null, name);
  }
  const kept = parse(at("", "Show.S01E05.[1080].mkv"));
  assert.deepEqual([kept.code.season, kept.code.episode], [1, 5]);
});

test("a bracketed episode above 1000 is still an episode", () => {
  const p = parse(at("", "One Piece [1062] [1080].mkv"));
  assert.equal(p.absolute, 1062);
  assert.equal(p.title, "One Piece");
  const pair = parse(at("", "[One Pace][1062-1063] Egghead 04 [1080p].mkv"));
  assert.equal(pair.absolute, 1062);
  const res = parse(at("", "Show [1080-1920].mkv"));
  assert.equal(res.absolute, null);
});

// ── Years and the words around them ─────────────────────────────────

test("a year is stripped after editorial noise, not before it", () => {
  // The year strip is $-anchored because "1917" and "Blade Runner 2049" are
  // titles. It only sees the year if the noise in front of it has come off
  // first, which was the wrong way round.
  assert.equal(parse(at("", "Alien.1979.REMASTERED.1080p.BluRay.x264-GRP.mkv")).title, "Alien");
  assert.equal(parse(at("", "Blade.Runner.2049.2017.IMAX.2160p.mkv")).title, "Blade Runner 2049");
  assert.equal(parse(at("", "Show.Name.2020.German.1080p.BluRay.x264-GRP.mkv")).title, "Show Name");
  assert.equal(parse(at("", "Show.Name.2019.EXTENDED.1080p.mkv")).title, "Show Name");
});

test("a film whose title is a number keeps it", () => {
  const p = parse(at("", "1917.2019.1080p.BluRay.x264-GRP.mkv"));
  assert.equal(p.title, "1917");
  assert.equal(p.year, 2019);
  assert.equal(p.isMovie, true);
});

// ── Words that are real title words ─────────────────────────────────

test("release noise that is also a title word survives", () => {
  assert.equal(parse(at("", "Web.of.Lies.S01E01.1080p.WEB-DL.mkv")).title, "Web of Lies");
  assert.equal(parse(at("", "Russian.Doll.S01E01.1080p.mkv")).title, "Russian Doll");
  assert.equal(parse(at("", "The.Italian.Job.2003.1080p.mkv")).title, "The Italian Job");
  assert.equal(parse(at("", "A.Series.of.Unfortunate.Events.S01E01.mkv")).title,
    "A Series of Unfortunate Events");
});

test("trailing cleanup does not trim a title down to articles", () => {
  // "The Limited Series" lost "Series", then "Limited", and was left as "The",
  // which searches for nothing. Neither editorial word is a title on its own,
  // so the pass stops before removing them.
  assert.equal(stripTrailingJunk("The Limited Series"), "The Limited Series");
  assert.equal(stripTrailingJunk("Severance WEB DL"), "Severance");
  assert.equal(cleanTitle("Severance WEB-DL.mkv", null), "Severance");
});

test("a title made of nothing but release noise is a placeholder", () => {
  const p = parse(at("Severance", "S02E03.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv"));
  assert.equal(p.title, "Severance", "the directory should replace a junk-only title");
  // With no directory there is nothing left to search for, so the parse fails
  // rather than searching TMDB for "WEB". Failing is what hands the file to
  // the manual picker.
  assert.equal(parse(at("", "S02E03.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv")), null);
});

test("a noise word next to a real word is not a placeholder", () => {
  assert.equal(parse(at("Severance", "Extended.1080p.mkv")).title, "Severance");
});
// ── Long-running series, and titles that look like numbers ─────────

test("a four-digit absolute number is placed, not read as season 1", () => {
  // "[Erai-raws] One Piece - 1062" is episode 1062, which no season list can
  // express. Capped at three digits it parsed as no episode at all, and the
  // panel then showed One Piece season 1.
  for (const [name, want] of [
    ["[Erai-raws] One Piece - 1062 [Multiple Subtitle][1080p][JSC].mkv", 1062],
    ["One Piece - 1062.mkv", 1062],
    ["One.Piece.1062.mkv", 1062],
    ["Show Name 1062.mkv", 1062]
  ]) {
    const p = parse(at("", name));
    assert.equal(p.absolute, want, name);
    assert.equal(p.code, null, name + " should not be read as S01E" + want);
    assert.doesNotMatch(p.title, /1062/, name + " kept the episode number as a title");
  }
});

test("a four-digit number with no show in the name is not an episode", () => {
  // "IMG_1234.MOV" has the same shape as an absolute episode number, and a
  // personal library is full of them. One word and four digits is a camera.
  for (const f of ["IMG_1234.MOV", "MVI_4321.MP4", "DSC_0123.JPG.mp4"]) {
    const p = parse(at("", f));
    assert.equal(p.absolute, null, f);
    assert.equal(p.code, null, f + " was given an episode");
  }
});

test("a bare four-digit E-marker is an absolute number too", () => {
  const p = parse(at("", "Show E1062.mkv"));
  assert.equal(p.absolute, 1062);
});

test("a title that starts with digits is not an episode number", () => {
  // 9-1-1 is a television series. The mid-name number pattern used to match at
  // the start of the string and report episode 9.
  for (const f of ["9-1-1.1080p.WEBRip.x264.mkv", "9-1-1.S01.1080p.WEB-DL.mkv",
                   "9-1-1.Lone.Star.S02.1080p.WEB-DL.mkv"]) {
    const p = parse(at("", f));
    // A bare season is fine; an episode number is not.
    assert.equal(p.code === null || p.code.episode === null, true, f + " invented an episode");
    assert.match(p.title, /^9-1-1/, f);
  }
  // The code still wins when there is one.
  assert.deepEqual([parse(at("", "9-1-1.S01E01.1080p.mkv")).code.season], [1]);
});

test("a title that is only digits survives when something says what it is", () => {
  const film = parse(at("", "300.2006.1080p.BluRay.x264.mkv"));
  assert.equal(film.title, "300");
  assert.equal(film.isMovie, true);
  const series = parse(at("", "24.S01E01.1080p.WEB-DL.mkv"));
  assert.equal(series.title, "24");
  assert.equal(series.code.episode, 1);
  const one = parse(at("", "M.1931.1080p.BluRay.mkv"));
  assert.equal(one.title, "M");
  assert.equal(one.year, 1931);
  // A counter with nothing else to identify it is still refused.
  assert.equal(parse(at("", "05.mkv")), null);
});

test("dotted initials keep their letters", () => {
  // The trailing single-letter rule was eating them.
  assert.equal(parse(at("", "S.W.A.T.S01E01.1080p.WEB-DL.mkv")).title, "S W A T");
  assert.equal(parse(at("", "N.C.I.S.S01E01.1080p.WEB-DL.mkv")).title, "N C I S");
  // …and a codec fragment still goes.
  assert.equal(cleanTitle("Severance DDP5 H 264", null), "Severance");
});

// ── Library layouts ────────────────────────────────────────────────

test("a leading counter with the episode name identifies from the directory", () => {
  const p = parse(at("Severance/Season 2", "05 - Hello, Ms. Cobel.mkv"));
  assert.equal(p.title, "Severance");
  assert.deepEqual([p.code.season, p.code.episode], [2, 5]);
  const dotted = parse(at("Severance/Season 2", "05. Hello, Ms. Cobel.mkv"));
  assert.equal(dotted.title, "Severance");
  assert.equal(dotted.code.episode, 5);
});

test("a descriptor folder inside a season folder is stepped over", () => {
  for (const dir of ["4K", "Official", "Dual Audio", "Final Cut", "UHD", "English"]) {
    const p = parse(at("Severance/Season 2/" + dir, "05.mkv"));
    assert.equal(p.title, "Severance", dir + " became the show name");
    assert.equal(p.code.episode, 5, dir);
  }
});

test("a season folder in another language is a season", () => {
  const p = parse(at("Severance/Temporada 2", "05.mkv"));
  assert.equal(p.title, "Severance");
  assert.deepEqual([p.code.season, p.code.episode], [2, 5]);
});

test("a season pack is identified with the season and no episode", () => {
  for (const [name, season] of [
    ["Severance.S02.COMPLETE.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv", 2],
    ["Severance.Season.2.1080p.WEB-DL.mkv", 2],
    ["The Bear S03 1080p WEB-DL.mkv", 3],
    ["9-1-1.S01.1080p.WEB-DL.mkv", 1]
  ]) {
    const p = parse(at("", name));
    assert.equal(p.code.season, season, name);
    assert.equal(p.code.episode, null, name + " invented an episode");
    assert.doesNotMatch(p.title, /S\d\d/, name + " kept the season in the title");
  }
});

// ── Fansub brackets ────────────────────────────────────────────────

test("a fansub group in front of the series is not read as the series", () => {
  // "[Group][Show][01][1080]" put the group first, so the first single-word
  // group became the title and the plugin searched for a show called "Group".
  const a = parse(at("", "[Group][Show][01][1080].mkv"));
  assert.equal(a.title, "Show");
  const b = parse(at("", "[SubsPlease][Frieren][21][1080p].mkv"));
  assert.equal(b.title, "Frieren");
  assert.equal(b.code.episode, 21);
  // The group is still available as a fallback candidate.
  assert.ok(a.altTitles.weak.includes("Group"));
});

test("a bracket group of track labels is not a series name", () => {
  // A multi-word group is otherwise trusted first, so "[Dual Audio]" and
  // "[Multiple Subtitle]" were searched before the show.
  const p = parse(at("", "[SubsPlease] Sousou no Frieren - 21 (1080p) [Dual Audio].mkv"));
  assert.equal(p.title, "Sousou no Frieren");
  assert.ok(!p.altTitles.strong.includes("Dual Audio"));
  const q = parse(at("", "[Erai-raws] One Piece - 1062 [Multiple Subtitle][1080p].mkv"));
  assert.ok(!q.altTitles.strong.includes("Multiple Subtitle"));
});

// ── Tags left in the title ─────────────────────────────────────────

test("a streaming service or language code is not part of the title", () => {
  assert.equal(parse(at("", "The.Bear.S03E01.1080p.HULU.WEB-DL.mkv")).title, "The Bear");
  assert.equal(parse(at("", "Stranger.Things.S04E01.1080p.NF.WEB-DL.DDP5.1.H.264-NTb.mkv")).title,
    "Stranger Things");
  assert.equal(parse(at("", "The_Mandalorian_S02E05_1080p_DISNEY+_WEB-DL_DDP5_1_atmos_H264-GROUP.mkv")).title,
    "The Mandalorian");
  // "Max" is a film.
  assert.equal(parse(at("", "Max.2022.1080p.WEB-DL.mkv")).title, "Max");
});

test("an IMDb id at the end of the name is removed from the title", () => {
  const p = parse(at("", "Severance.S02E03.1080p.WEB-DL.DDP5.1.H.264.imdb.tt11280740.mkv"));
  assert.equal(p.title, "Severance");
  assert.equal(p.imdbId, "tt11280740");
});

test("a date in the name is not a release year", () => {
  // Otherwise the file looked like a film and every query went to search/movie.
  const p = parse(at("", "The.Daily.Show.2023.01.15.1080p.WEB.h264-GROUP.mkv"));
  assert.equal(p.year, null);
  assert.equal(p.isMovie, false);
});

// ── Codec chains in dotted names ────────────────────────────────────

test("a dot-separated codec chain does not eat the release group", () => {
  // The chain crosses dots and "265" is a legal chain token, so the final
  // separator+digit of "Atmos.DV.HDR.H.265-4kHdHub" matched at the group's
  // first digit: the tag and the "4" went together and "kHdHub" stayed in the
  // title. A space breaks the chain, so only dotted names were hit.
  const p = parse(at("", "VisionQuest.S01E01.No.Strings.2160p.DSNP.WEB-DL.Multi.DDP5.1.Atmos.DV.HDR.H.265-4kHdHub.Com.mkv"));
  // "No Strings" and the DSNP tag are the episode's own title and a service
  // tag, both after the code, so neither reaches the title any more. The
  // release group is what this test is about, and it is gone as well.
  assert.equal(p.title, "VisionQuest");
  assert.equal(p.code.episode, 1);
  // Any group that starts with a digit is the shape that trips it.
  assert.equal(parse(at("", "Oppenheimer.2023.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-3L.mkv")).title,
    "Oppenheimer");
  // The specs this rule exists for still come off whole.
  assert.equal(parse(at("", "The.Matrix.1999.1080p.BluRay.x264.DTS-HD.MA.5.1.mkv")).title, "The Matrix");
  assert.equal(parse(at("", "Show_Name_S02E05_1080p_DDP5_1_atmos_H264-GROUP.mkv")).title, "Show Name");
});

test("the dotted release identifies the show instead of exhausting the ladder", async () => {
  // The leftover "DSNP WEB- Multi kHdHub" gave the title seven candidate
  // prefixes, and AUTO_MAX_TRIES kept the six longest, which dropped the only
  // one that could match. Every query carried the noise and TMDB answered none
  // of them, so the panel settled on "No match for …mkv". The parsed title and
  // the end-to-end outcome are both the point of this one.
  const app = boot({
    "/3/search/tv": (url) =>
      /query=VisionQuest$/.test(decodeURIComponent(url))
        ? { results: [{ id: 55555, name: "Vision Quest", vote_count: 100, poster_path: "/vq.jpg" }] }
        : { results: [] },
    "/3/tv/55555/season/1": {
      poster_path: "",
      episodes: [{ episode_number: 1, name: "No Strings", air_date: "2026-10-14" }]
    },
    "/3/tv/55555": {
      id: 55555, name: "Vision Quest",
      seasons: [{ season_number: 1, episode_count: 8 }], images: {}
    }
  });
  await identify(app,
    "file:///v/VisionQuest.S01E01.No.Strings.2160p.DSNP.WEB-DL.Multi.DDP5.1.Atmos.DV.HDR.H.265-4kHdHub.Com.mkv");
  const info = selected(app);
  assert.ok(info, "the show was not identified");
  assert.equal(info.showTitle, "Vision Quest");
  assert.equal(info.code, "S01E01");
  assert.equal(info.epTitle, "No Strings");
});

// ── Regressions the fixes themselves introduced ─────────────────────

test("a three-letter language code that is a real title word is kept", () => {
  // Adding "chi", "spa", "max" and "peacock" to the noise list deleted The Chi,
  // Chi-Raq, Spa and Peacock. A short code is a title word more often than a
  // release tag.
  assert.equal(parse(at("", "Chi-Raq.2015.1080p.mkv")).title, "Chi-Raq");
  assert.equal(parse(at("", "The.Chi.S01E01.1080p.WEB-DL.mkv")).title, "The Chi");
  assert.equal(parse(at("", "Peacock.S01E01.1080p.mkv")).title, "Peacock");
  assert.equal(parse(at("", "Spa.S01E01.mkv")).title, "Spa");
  assert.equal(parse(at("", "Max.2022.1080p.WEB-DL.mkv")).title, "Max");
  // The ones that are not words still go.
  assert.equal(parse(at("", "Show.S01E01.NF.WEB-DL.mkv")).title, "Show");
});

test("an air year in brackets is not an absolute episode", () => {
  // "[Doki] Show - 01 [1920x1080][BDRip][2011][JSC]" put the year in the
  // episode slot, which suppressed the real code and made every query a film
  // search. parseEpisodeCode has always refused a year; this now matches.
  const p = parse(at("", "[Doki] Show Name - 01 [1920x1080][BDRip][2011][JSC].mkv"));
  assert.equal(p.absolute, null);
  assert.equal(p.code.episode, 1);
  assert.equal(p.isMovie, false);
  const q = parse(at("", "Show Name S01E05 [1994] [1080p].mkv"));
  assert.deepEqual([q.code.season, q.code.episode], [1, 5]);
  assert.equal(q.absolute, null);
});

test("a descriptor folder made of several words is stepped over", () => {
  // Matching the whole segment missed "4K HDR", which Plex writes inside season
  // folders, and each one became the name of the show.
  for (const dir of ["4K HDR", "4K WEB-DL", "Official 4K", "2160p", "1080p",
                     "Final Cut", "Dual Audio", "Director's Cut", "HDR10"]) {
    const p = parse(at("Severance/Season 2/" + dir, "05.mkv"));
    assert.equal(p.title, "Severance", dir + " became the show name");
    assert.equal(p.code.episode, 5, dir);
  }
  // Two descriptor folders deep still reaches the show.
  const deep = parse(at("Severance/Season 2/4K/Official", "05.mkv"));
  assert.equal(deep.title, "Severance");
});

test("a date in the name is neither an episode nor a year", () => {
  // Plex names daily episodes exactly like this. The trailing number pattern
  // read the "15" as episode 15, and the year made every query search films.
  for (const f of ["The Daily Show - 2023-01-15.mkv", "The.Daily.Show.2023.01.15.1080p.WEB.h264-GROUP.mkv",
                   "Last Week Tonight 2023-01-15.mkv"]) {
    const p = parse(at("", f));
    assert.equal(p.code, null, f + " was given an episode");
    assert.equal(p.year, null, f + " was given a release year");
    assert.equal(p.isMovie, false, f);
    assert.match(p.title, /Daily Show|Week Tonight/, f);
  }
});

test("a leading counter outside a season folder is left alone", () => {
  // People name their own files "01 - Christmas 2019.mp4". Without a directory
  // to supply the show, stripping the counter leaves "Christmas" as a film to
  // search for on a file that should be ignored entirely.
  for (const f of ["01 - Christmas 2019.mp4", "05 - Birthday Party.mp4", "1. Family Reunion.mov"]) {
    const p = parse(at("", f));
    assert.equal(p.code, null, f + " was given an episode");
  }
  // A film whose title starts with digits is untouched.
  assert.equal(parse(at("", "2001 - A Space Odyssey.1968.mkv")).title, "2001 - A Space Odyssey");
});
// ── Fansub layouts and absolute numbering ──────────────────────────
test("a bracket group is recovered as a series name", () => {
  const p = h.global.parseFilename("file:///v/" + FANSUB);
  // "En Sub" is an English-subtitle label, not a series name. It used to be
  // offered as a strong candidate and cost a search before the show's own name.
  assert.deepEqual(Array.from(p.altTitles.strong), ["One Pace"]);
  // A CRC32 is not a title.
  assert.ok(!Array.from(p.altTitles.strong).includes("FD5592BE"));
  assert.equal(p.altTitles.weak.length, 0);
});

test("the fansub's trailing counter is not treated as an episode", () => {
  const p = h.global.parseFilename("file:///v/" + FANSUB);
  // "04" is the fansub's own counter, and 1062 cannot be mapped to a season.
  assert.equal(p.code, null);
  assert.equal(p.absolute, 1062);
});

test("a resolution bracket is not an absolute episode number", () => {
  // Regression: "[1080p]" was read as the number 1080, which threw away the
  // episode code of every such file.
  const p = h.global.parseFilename("file:///v/Attack on Titan - 12 [1080p].mkv");
  assert.equal(p.absolute, null);
  assert.equal(p.code.episode, 12);
  assert.equal(p.title, "Attack on Titan");
});

test("a CRC32 bracket is not an absolute episode number", () => {
  const p = h.global.parseFilename("file:///v/One Piece - 62 [1080p][FD5592BE].mkv");
  assert.equal(p.absolute, null, "a CRC32 was read as an episode number");
  // The episode code is untouched.
  assert.equal(p.code.episode, 62);
  assert.equal(p.title, "One Piece");
  // And the CRC is not offered as a series name either.
  assert.deepEqual(Array.from(p.altTitles.strong), []);
  assert.deepEqual(Array.from(p.altTitles.weak), []);
});

test("a single-word group is kept as a last resort, not a first guess", () => {
  const p = h.global.parseFilename("file:///v/[SubsPlease] Frieren - 05 (1080p).mkv");
  assert.deepEqual(Array.from(p.altTitles.strong), []);
  assert.deepEqual(Array.from(p.altTitles.weak), ["SubsPlease"]);
  assert.equal(p.title, "Frieren");
  assert.equal(p.code.episode, 5);
});

// ── Searching ───────────────────────────────────────────────────────

test("a near-miss spelling still matches the series", () => {
  const { titleScore } = loadSidebar().global;
  // Fansubs misspell; token overlap alone scores this 0.33 and would send the
  // ladder past the right answer.
  assert.ok(titleScore("One Pace", "One Piece") >= 0.6,
    `score was ${titleScore("One Pace", "One Piece")}`);
  // But genuinely different names must not creep over the line.
  assert.ok(titleScore("One Pace", "One Piece: Clockwork") < 0.75);
});

test("the fansub filename identifies One Piece on the first query", async () => {
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  await identify(app, "file:///v/" + FANSUB);
  const queries = searchedQueries(app.fetchCalls).filter(Boolean);
  assert.deepEqual(queries, ["One Pace"], `queried ${JSON.stringify(queries)}`);
  assert.equal(app.document.getElementById("q").value, "One Piece");
});

test("the absolute number is placed by adding up the seasons", async () => {
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  await identify(app, "file:///v/" + FANSUB);
  // 1062 is not S01E1062 and not the fansub's "04". Twenty fifty-episode
  // seasons put the running total at 1000, so it is season 21, episode 62.
  const info = selected(app);
  assert.ok(info, "nothing was selected");
  assert.equal(info.showTitle, "One Piece");
  assert.equal(info.code, "S21E62");
});

test("an absolute number past the end of every season claims nothing", async () => {
  const app = boot({
    "/3/search/tv": ONE_PIECE_RESULTS,
    "/3/tv/37854": { id: 37854, name: "One Piece", seasons: [{ season_number: 1, episode_count: 50 }], images: {} }
  });
  await identify(app, "file:///v/" + FANSUB);
  assert.equal(selected(app), null, "an episode was invented from an unplaceable number");
  assert.match(app.document.getElementById("panel").innerHTML, /pickSeason/,
    "the picker should be left for the user");
});

test("an absolute number in a season TMDB has not counted yet is not season 1", async () => {
  // The newest seasons of a long-running show carry no episode_count until
  // TMDB publishes one, so the running total stops short of the number in the
  // filename. locateAbsolute gave up, and the caller then opened season 1
  // because that was the first entry in the list, which is how a One Piece
  // file from season 36 was reported as season 1.
  const seasons = [];
  for (let i = 1; i <= 20; i++) seasons.push({ season_number: i, episode_count: 50 });
  seasons.push({ season_number: 21 });   // newest, and still uncounted
  const app = boot({
    "/3/search/tv": ONE_PIECE_RESULTS,
    "/3/tv/37854": { ...ONE_PIECE, number_of_seasons: 21, seasons }
  });
  await identify(app, "file:///v/" + FANSUB);
  // 1062 is past the counted total of 1000, so the season is knowable but the
  // episode within it is not. Nothing may be invented.
  assert.equal(selected(app), null, "an episode number was invented");
  const panel = app.document.getElementById("panel").innerHTML;
  assert.match(panel, /pickSeason\(21\)/, `not left on the newest season: ${panel}`);
  assert.doesNotMatch(panel, /class="pill on"[^>]*>S01/, "opened season 1 anyway");
});

test("an absolute number past every counted season lands on the newest, not season 1", async () => {
  // TMDB's season splits lag a long-running show: the newest season carries
  // fewer episodes than have actually aired, so the running total stops below
  // the fansub's own numbering. Every season here has a count, so the
  // uncounted-season path does not apply and this returned null. The caller
  // then opened season 1 because that was the first entry in the list, which is
  // how a One Piece file from season 36 was reported as season 1.
  const seasons = [];
  for (let i = 1; i <= 35; i++) seasons.push({ season_number: i, episode_count: 30 });
  seasons.push({ season_number: 36, episode_count: 3 });
  const app = boot({
    "/3/search/tv": ONE_PIECE_RESULTS,
    "/3/tv/37854": { ...ONE_PIECE, number_of_seasons: 36, seasons },
    "/3/tv/37854/season/36": {
      poster_path: "",
      episodes: [
        { episode_number: 1, name: "a", air_date: "2025-07-06" },
        { episode_number: 2, name: "b", air_date: "2025-07-13" },
        { episode_number: 3, name: "c", air_date: "2025-07-20" }
      ]
    }
  });
  await identify(app, "file:///v/[One Pace][1067-1068] Egghead 07 [1080p][En Sub][07BDAEEE].mp4");
  // 1067 is past the counted total of 1053, so the season is knowable and the
  // episode inside it is not. Nothing may be invented.
  assert.equal(selected(app), null, "an episode number was invented");
  const panel = app.document.getElementById("panel").innerHTML;
  assert.match(panel, /pickSeason\(36\)/, `not left on the newest season: ${panel}`);
  assert.doesNotMatch(panel, /class="pill on"[^>]*>S01/, "opened season 1 anyway");
});

test("a four-digit number with no bracket range is located by absolute number", async () => {
  // 1062 is four digits, which used to be refused as a possible year, so an
  // Erai-raws One Piece file identified nothing at all. It is an episode
  // number now, and because it is past anything a season can express it is
  // placed by adding up the show's seasons rather than read as S01E1062.
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  const p = app.global.parseFilename("file:///v/[SubsPlease] One Piece - 1062 [1080p].mkv");
  assert.equal(p.title, "One Piece");
  assert.equal(p.absolute, 1062);
  assert.equal(p.code, null);

  const started = app.global.autoIdentify("file:///v/[SubsPlease] One Piece - 1062 [1080p].mkv");
  await settle();
  assert.equal(started, true);
  assert.ok(searchedQueries(app.fetchCalls).filter(Boolean).length > 0);
});

test("a fansub file with a three-digit code still auto-selects", async () => {
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  await identify(app, "file:///v/[SubsPlease] One Piece - 062 [1080p].mkv");
  const info = selected(app);
  assert.ok(info, "nothing was selected");
  assert.equal(info.showTitle, "One Piece");
  assert.equal(info.code, "S01E62");
  assert.equal(info.epTitle, "Now Stand Up!");
});

test("a release-group bracket costs nothing when the filename title is good", async () => {
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  await identify(app, "file:///v/[SubsPlease] One Piece - 05 (1080p).mkv");
  // "SubsPlease" is a weak candidate, so it is never reached: the real title
  // answers on the first query.
  assert.deepEqual(searchedQueries(app.fetchCalls).filter(Boolean), ["One Piece"]);
});

// ── The remembered entry has to agree with an absolute number too ────────

test("a remembered episode is re-checked against an absolute number", async () => {
  // The staleness test only compared the filename's SxxEyy code, so a file
  // numbered by absolute episode had no check at all: whatever was remembered
  // for that URL was replayed, however wrong. The comment above that test
  // claims the filename is ground truth for the episode, and for these files
  // it was not being consulted.
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  const url = "file:///v/" + FANSUB;
  app.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(selected(app).code, "S21E62", "the fixture should identify first");

  // Strip the recorded absolute number, which is what an entry written before
  // that field existed looks like: it cannot be checked, so it is rebuilt once.
  const map = JSON.parse(app.localStorage.getItem("epinfo_url_map"));
  delete map[url].absoluteFrom;
  map[url].code = "S01E01";
  map[url].season = 1;
  map[url].episode = 1;
  app.localStorage.setItem("epinfo_url_map", JSON.stringify(map));

  // Play something else first: a repeat of fileChanged for the file already
  // playing is a deliberate no-op, so it cannot stand in for "the user came
  // back".
  app.iina._emit("fileChanged", { url: "file:///v/Severance.S01E01.mkv" });
  await settle();
  const before = app.fetchCalls.length;
  app.iina._emit("fileChanged", { url });
  await settle();
  assert.ok(app.fetchCalls.length > before,
    "the unchecked entry was replayed instead of re-identified");
  assert.equal(selected(app).code, "S21E62", "the wrong remembered episode survived");
});

test("a renumbered absolute file is re-identified rather than replayed", async () => {
  const app = boot({
    "/3/search/tv": ONE_PIECE_RESULTS,
    // Absolute 1070 lands on episode 70, so the season has to list it.
    "/3/tv/37854/season/21": {
      poster_path: "",
      episodes: [
        { episode_number: 62, name: "The Very, Very, Very Strongest Sea Punk", air_date: "2025-12-07" },
        { episode_number: 70, name: "Egghead", air_date: "2026-02-01" }
      ]
    }
  });
  const url = "file:///v/" + FANSUB;
  app.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(selected(app).code, "S21E62");

  // Same URL, but the file behind it has been renumbered. The remembered
  // episode still looks internally consistent, so only the recorded number
  // gives it away.
  const renamed = "file:///v/[One Pace][1070-1071] Egghead 12 [1080p][En Sub][FD5592BE].mp4";
  const map = JSON.parse(app.localStorage.getItem("epinfo_url_map"));
  map[renamed] = map[url];
  app.localStorage.setItem("epinfo_url_map", JSON.stringify(map));

  app.iina._emit("fileChanged", { url: "file:///v/Severance.S01E01.mkv" });
  await settle();
  const before = app.fetchCalls.length;
  app.iina._emit("fileChanged", { url: renamed });
  await settle();
  assert.ok(app.fetchCalls.length > before,
    "an entry built from a different absolute number was replayed");
  assert.equal(selected(app).code, "S21E70", "the old episode number survived a rename");
});

test("a remembered episode that still agrees with the absolute number is kept", async () => {
  // The counterpart to the test above: re-identifying a correct entry on every
  // return would cost a request per replay of every file.
  const app = boot({ "/3/search/tv": ONE_PIECE_RESULTS });
  const url = "file:///v/" + FANSUB;
  app.iina._emit("fileChanged", { url });
  await settle();
  app.iina._emit("fileChanged", { url: "file:///v/Severance.S01E01.mkv" });
  await settle();
  // Counted after the excursion, which does a lookup of its own, so the
  // assertion is about this file and nothing else.
  const before = app.fetchCalls.length;
  app.iina._emit("fileChanged", { url });
  await settle();
  assert.equal(app.fetchCalls.length, before, "a still-correct entry was re-fetched");
  assert.equal(selected(app).code, "S21E62");
});

// ── Numbers that belong to the title ────────────────────────────────

test("a number that is part of the title survives the trailing passes", () => {
  // The trailing-junk pass dropped any 1–3 digit token that followed a real
  // word, so "Station 19" became "Station", "Room 104" became "Room" and
  // "Spider-Man 3" became "Spider-Man" — the last one identifying a different
  // film, because the 2002 original matched the year instead.
  const cases = [
    ["Station.19.S01E01.1080p.WEB-DL.mkv", "Station 19", "S1E1"],
    ["Room.104.S01E01.mkv", "Room 104", "S1E1"],
    ["Catch-22.S01E01.mkv", "Catch-22", "S1E1"]
  ];
  for (const [file, want, code] of cases) {
    const p = parse(at("", file));
    assert.equal(p.title, want, file);
    assert.equal("S" + p.code.season + "E" + p.code.episode, code, file);
  }
  // A film keeps its number and its year, which is what tells the sequels
  // apart: "Spider-Man.3.2002" used to be looked up as the 2002 Spider-Man.
  for (const [file, want, year] of [
    ["Spider-Man.3.2002.1080p.mkv", "Spider-Man 3", 2002],
    ["Apollo.13.1995.mkv", "Apollo 13", 1995],
    ["Room.104.2019.mkv", "Room 104", 2019]
  ]) {
    const p = parse(at("", file));
    assert.equal(p.title, want, file);
    assert.equal(p.year, year, file);
    assert.equal(p.isMovie, true, file);
  }
  // Numbers that were already handled keep working.
  for (const [file, want] of [
    ["The.100.S01E01.mkv", "The 100"],
    ["9-1-1.S01E01.mkv", "9-1-1"],
    ["Hawaii.Five-0.2010.mkv", "Hawaii Five-0"],
    ["1917.2019.1080p.mkv", "1917"]
  ]) {
    assert.equal(parse(at("", file)).title, want, file);
  }
});

test("a leftover number still comes off", () => {
  // The other half: padded counters and digits hanging off a removed tag are
  // not titles, and keeping them would search for them.
  assert.equal(cleanTitle("Severance WEB- 1", null), "Severance");
  assert.equal(cleanTitle("Whatever 04", null), "Whatever");
  const p = parse(at("", "[One Pace][1062-1063] Egghead 12 [1080p][En Sub][FD5592BE].mp4"));
  assert.equal(p.title, "Egghead", "the fansub counter was kept");
  assert.equal(p.absolute, 1062);
});

test("the E-marker goes with the absolute number it was promoted from", () => {
  // "Show E1062" was promoted to an absolute number, but the code-removal
  // path no longer ran (code was null by then), so the search was "Show E".
  const p = parse(at("", "[AnimePahe] Show E1062 1080p.mkv"));
  assert.equal(p.title, "Show");
  assert.equal(p.absolute, 1062);
});

test("an underscore-joined codec chain is removed with its tag", () => {
  // "\b" cannot match between "_" and "DDP5_1", so this rule never fired on
  // the names it was written for; the "1" it left behind was dropped later by
  // the trailing pass, which no longer drops bare numbers.
  assert.equal(parse(at("", "Show_Name_S02E05_1080p_DDP5_1_atmos_H264-GROUP.mkv")).title,
    "Show Name");
  assert.equal(parse(at("", "Some.Show.05.DDP5_1.x264.mkv")).code.episode, 5,
    "the episode number the codec tag was hiding");
});

test("S01E00 is an episode, not a parse failure", () => {
  // "!r.episode" also rejected zero, so the raw code stayed in the title and
  // the file was handed to the manual search instead.
  const p = parse(at("", "Show.S01E00.mkv"));
  assert.equal(p.title, "Show");
  assert.equal(p.code.season, 1);
  assert.equal(p.code.episode, 0);
});

// ── The directory a pick can fall back to ───────────────────────────

test("the walk's directory survives a filename that supplied its own title", () => {
  // The pin writer reads this when the user picks a show the filename did not
  // name. "AnimePahe Bleach - Sennen Kessen-hen - 41" names nothing TMDB has,
  // and the folder beside it is the only thing that did.
  const p = parse("file:///Volumes/Transcend/watching/anime/Bleach%20TYBW%20The%20Calamity/"
    + "AnimePahe_Bleach_-_Sennen_Kessen-hen_-_41_1080p_Disney_Plus.mp4");
  // "… - 41 Plus" is the code and a service tag, both after the show's name,
  // so the title is the show itself.
  assert.equal(p.title, "AnimePahe Bleach - Sennen Kessen-hen");
  assert.equal(p.titleDir, "", "the filename's own title was not kept");
  assert.equal(p.folderDir, "Bleach TYBW The Calamity");
  assert.equal(typeof p.folderDir, "string");
});

test("a filename with nothing to fall back to offers no directory", () => {
  // "Videos" is FOLDER_NOISE, so the walk stops before it and a pick in a flat
  // library has nothing to pin.
  const p = parse("file:///Users/me/Videos/Severance S01E01.mkv");
  assert.equal(p.folderDir, "");
});

test("the directory that supplied the title is offered as folderDir as well", () => {
  const p = parse(at("Samurai champloo", "11.mkv"));
  assert.equal(p.titleDir, "Samurai champloo");
  assert.equal(p.folderDir, "Samurai champloo");
});

// ── Where the season came from ──────────────────────────────────────
// A pinned folder's remembered season may replace one that was only assumed,
// never one that was stated — and a season written in the file's own folder is
// a statement, not an assumption.

test("a season the folder supplied is marked as the folder's", () => {
  const p = parse("file:///Users/me/Videos/Severance/Season%203/05.mkv");
  assert.equal(p.code.season, 3);
  assert.equal(p.code.seasonFromName, false);
  assert.equal(p.code.seasonFromFolder, true);
});

test("a season the filename stated is not marked as the folder's", () => {
  const p = parse(at("", "Show.S02E05.mkv"));
  assert.equal(p.code.season, 2);
  assert.equal(p.code.seasonFromName, true);
  assert.ok(!p.code.seasonFromFolder, "a stated season was marked as the folder's");
});

test("a season nothing stated is marked as neither", () => {
  // "… - 42" is the shape the folder's season exists for: the 1 is a
  // placeholder, not an answer.
  const p = parse(at("Bleach TYBW The Calamity", "AnimePahe_Bleach_-_Sennen_Kessen-hen_-_42_1080p_Disney_Plus.mp4"));
  assert.equal(p.code.season, 1);
  assert.equal(p.code.seasonFromName, false);
  assert.ok(!p.code.seasonFromFolder, "an assumed season was marked as the folder's");
});

// ── The episode's own title after the code ──────────────────────────

test("the title stops at the episode code", () => {
  // Everything after the code is the episode's own title and the release tags,
  // and TMDB wants every word, so the whole thing asked six questions that all
  // came back empty while the show's own name sat just past the budget.
  const p = parse("file:///Users/me/Videos/"
    + "Hells.Paradise.S01E01.The.Death.Row.Convict.and.the.Executioner.1080p.CR.WEB-DL.AAC2.0.H.264-HDC.mkv");
  assert.equal(p.title, "Hells Paradise");
  assert.equal(p.code.season, 1);
  assert.equal(p.code.episode, 1);
});

test("a multi-episode code is cut at its first episode", () => {
  const p = parse(at("", "Show.S01E01E02.The.Title.1080p.mkv"));
  assert.equal(p.title, "Show");
  assert.equal(p.code.episode, 1);
  assert.equal(p.code.extra, 2);
});

test("a name that writes the code first keeps its cleaned title", () => {
  // Nothing is left standing in front of the code, so the whole cleaned name
  // stands as before. A show's name written after the code is rare, and this is
  // the shape it arrives in.
  const p = parse(at("", "S01E01.The.Death.Row.mkv"));
  assert.equal(p.title, "The Death Row");
  assert.equal(p.code.episode, 1);
});

test("a title that is only a code still comes from the directory", () => {
  const p = parse(at("Severance", "S01E01.mkv"));
  assert.equal(p.title, "Severance");
  assert.equal(p.titleDir, "Severance");
});

test("a dotted directory name keeps its last word", () => {
  // cleanTitle's extension pass is for whole filenames. A directory segment is
  // a fragment, and running that pass on one ate the word after the dot:
  // "My.Show" cleaned down to "My".
  const p = parse(at("My.Show", "05.mkv"));
  assert.equal(p.title, "My Show");
});

// ── A folder per cour, EP.<n> files ────────────────────────────────

test("EP.1 is an episode number, and the folder names the show", () => {
  // "megalobox/1/EP.1.720p.mp4": the marker is the whole filename, so the show
  // has to come from the directory — and it did not, because "EP 1" was read as
  // a title and searched for.
  const p = parse("file:///Volumes/Transcend/movies/anime/megalobox/1/EP.1.720p.mp4");
  assert.equal(p.title, "megalobox");
  assert.equal(p.titleDir, "megalobox");
  assert.equal(p.code.season, 1);
  assert.equal(p.code.episode, 1);
});

test("a bare number folder is the season, where the show is above it", () => {
  // The same library puts each cour in "1", "2", …: season 1 of MEGALOBOX and
  // season 2 of it, which the marker alone cannot tell apart.
  const p = parse("file:///Volumes/Transcend/movies/anime/megalobox/2/EP.1.v0.720p.mp4");
  assert.equal(p.title, "megalobox");
  assert.equal(p.code.season, 2);
  assert.equal(p.code.episode, 1);
});

test("a version suffix is not a title", () => {
  // "EP.13.v0.720p" left "v0" as the title once the marker and the resolution
  // were off it, and a title that names nothing has to give way to the folder.
  const p = parse("file:///Volumes/Transcend/movies/anime/megalobox/1/EP.13.v0.720p.mp4");
  assert.equal(p.title, "megalobox");
  assert.equal(p.code.episode, 13);
});

test("Episode 5 and EP 5 are the same marker", () => {
  const p = parse(at("Severance", "Episode 5.mkv"));
  assert.equal(p.code.episode, 5);
  assert.equal(p.title, "Severance");
});

test("a bare number folder that is a year is still a year", () => {
  // The year rule stops the walk before the season rule can read it, so a film
  // in "/movies/2024/" does not become season 24 of anything.
  const p = parse("file:///Users/me/movies/2024/Some.Film.mkv");
  assert.equal(p.code, null);
  assert.equal(p.title, "Some Film");
});

// ── The counter beside an absolute number ───────────────────────────

test("the counter beside an absolute number is kept", () => {
  // "Egghead 08" of a recut, whose season is numbered by these counters even
  // though the source marks the same episode 1069. Only a folder pin gives it
  // a season to mean anything in, which is why the parser keeps it.
  const p = parse("file:///v/[One Pace][1069-1070] Egghead 08 Extended [1080p][En Sub][224EEF70].mp4");
  assert.equal(p.absolute, 1069);
  assert.equal(p.counter, 8);
  assert.equal(p.title, "Egghead");
});

test("a name with no counter reports none, and no counter is invented", () => {
  // The bracket group is the absolute number here and nothing follows it.
  const p = parse("file:///v/[Group][1062-1063] Show [1080p].mp4");
  assert.equal(p.absolute, 1062);
  assert.equal(p.counter, null);
  assert.equal(p.title, "Show");
});

test("a resolution that escaped its brackets is not a counter", () => {
  const p = parse("file:///v/[Group][1062-1063] Show 720p.mkv");
  assert.equal(p.absolute, 1062);
  assert.equal(p.counter, null);
});

test("an episode code leaves no counter behind", () => {
  // The counter is only read where the episode is an absolute number: with a
  // real code, the code is the episode.
  const p = parse(at("", "Show.S01E09.mkv"));
  assert.equal(p.code.episode, 9);
  assert.equal(p.counter, null);
});
