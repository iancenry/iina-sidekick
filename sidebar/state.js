var TK = localStorage.getItem("epinfo_tmdb_key") || "";
// Poster and logo URLs were written out as literals at six call sites, in three
// different sizes, with nothing recording which was which.
var IMG_BASE = "https://image.tmdb.org/t/p/";
var IB   = IMG_BASE + "w92";    // search results
var IW   = IMG_BASE + "w500";   // the card's poster (or an episode's still)
var IL   = IMG_BASE + "w780";   // the title treatment

var selShow      = null;
var selSeason    = null;
var descExpanded = false;

// FIX: Store episodes in a plain JS array and reference by index.
// Previously, episodes were JSON.stringify'd + encodeURIComponent'd
// and embedded directly in onclick="pickEp('...')". Any episode whose
// name or overview contained a " character would corrupt the HTML
// attribute and silently break the button. Index-based lookup is
// immune to all character escaping issues.
var episodeCache = [];
// Totals from the show detail response, for the "Season 2 of 3" context line.
// Null until a show has been opened.
var showTotals = null;
var seasonPosterUrl = "";
// The show's title treatment, from the /tv/{id} detail response we already
// fetch. Kept here so every episode of the show can reuse it.
var showLogoUrl = "";

// ── Filename parsing → automatic identification ─────────────────
// The plugin reads the filename, works out the show title and season/episode,
// then identifies the file on its own. Anything it can't parse falls back to
// manual search, so a name it cannot read costs a search box rather than a
// wrong answer.

// A miss costs a full round trip, and the ladder can need several before it
// lands, so this has to cover more than one query.
var AUTO_SEARCH_MS = 25000;   // give up on TMDB and show the panel
var AUTO_MAX_TRIES = 6;       // bound the worst case
var autoTimerId = null;
// main.js re-emits fileChanged when the sidebar reports ready, so the same
// URL can arrive twice. Track what's in flight so we only search once.
var autoInFlight = {};
// Bumped whenever the live lookup must be abandoned: a different file, or the
// user clearing the selection. Every async callback captures the value it
// started with and abandons its work when it no longer matches.
//
// This replaces a guard that read `autoTimerId === null` to mean "still
// live". That was wrong in two ways. A duplicate fileChanged for the same URL
// cancelled the timer and then returned early, so the in-flight lookup found
// a null timer and dropped its result: the file silently failed to identify.
// And nothing tied a response to the URL that asked for it, so a slow reply
// could write file A's identification into file B's cache entry.
var lookupEpoch = 0;
function invalidateLookups() {
  lookupEpoch++;
  autoCancelTimer();
}

// Candidates TMDB has already answered with nothing, so the ladder does not
// ask the identical question again. A release-group suffix ("Show Name
// BluMovie") sits on every file of a batch, and without this each new episode
// spent its first round trip re-learning that the suffix is noise. Only an
// empty result set is remembered: a network failure is not an answer, and a
// candidate that failed must be tried again. Session-scoped and time-bound,
// so nothing is written to storage and a TMDB index update heals in minutes.
//
// Keyed by endpoint as well as query: "Foo" having no series on TMDB says
// nothing about whether it has a film, and a shared key made the TV miss
// answer the film's question too.
var searchMisses = {};
var SEARCH_MISS_TTL_MS = 10 * 60 * 1000;
var SEARCH_MISS_CAP = 200;
function searchMissed(endpoint, q) {
  var at = searchMisses[endpoint + "\u0000" + q];
  return at && (Date.now() - at) < SEARCH_MISS_TTL_MS;
}
function noteSearchMiss(endpoint, q) {
  searchMisses[endpoint + "\u0000" + q] = Date.now();
  var keys = Object.keys(searchMisses);
  if (keys.length <= SEARCH_MISS_CAP) return;
  // Drop the oldest half rather than growing for the life of the session; the
  // cap is only reachable by a large scan, where the oldest answers are the
  // ones a returning user is least likely to repeat.
  keys.sort(function(a, b) { return searchMisses[a] - searchMisses[b]; });
  for (var i = 0; i < keys.length / 2; i++) delete searchMisses[keys[i]];
}

// A token identifies which lookup a piece of async work belongs to, so a
// response can be matched back to the file that asked for it. Manual picks
// pass nothing: the user is driving those, and nothing races them.
function tokenLive(t) {
  if (!t) return true;
  return t.epoch === lookupEpoch && currentVideoUrl === t.url;
}
