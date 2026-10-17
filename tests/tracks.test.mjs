// Preferred language and SDH selection: the sidebar's preference applied when
// a file opens, and the SDH marker on the remembered subtitle copy.
//
// The matcher exists because a file can open on a track the viewer does not
// speak — a Hindi default in an English household — and because "Prefer SDH"
// must be told apart from Hindi: "hi" is a language code, not a marker.
//
// Every test here was checked by breaking the behaviour it names and watching
// it fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMain } from "./helpers/main-harness.mjs";
import { loadSidebar } from "./helpers/harness.mjs";

const EPISODE = {
  isMovie: false, showTitle: "Game of Thrones", epTitle: "The Kingsroad", code: "S01E02",
  airDate: "", rating: "", overview: "", posterUrl: "", logoUrl: "",
  context: "", tmdbId: "1399", season: 1, episode: 2
};

function boot() {
  const m = loadMain();
  return { m, g: m.global };
}

function session(opts = {}) {
  const m = loadMain(Object.assign({
    status: { paused: false, duration: 1400, url: "file:///v/a.mkv" }
  }, opts));
  m.emit("iina.window-loaded");
  m.runTimers();
  return m;
}

function posted(h, name) {
  return h.iina._posted.filter((x) => x.name === name).map((x) => x.payload);
}

const HINDI_AUDIO = {
  id: 1, lang: "hin", title: "Hindi", isSelected: true, isDefault: true, isExternal: false
};
const ENGLISH_AUDIO = {
  id: 2, lang: "eng", title: "English", isSelected: false, isDefault: false, isExternal: false
};

// ── The matcher ─────────────────────────────────────────────────────

test("every accepted spelling of a language canonicalizes", () => {
  const { g } = boot();
  assert.equal(g.canonLang("ENG"), "en");
  assert.equal(g.canonLang("english"), "en");
  assert.equal(g.canonLang("en-US"), "en");
  assert.equal(g.canonLang("fre"), "fr");
  assert.equal(g.canonLang("zho"), "zh");
  assert.equal(g.canonLang("yue"), "yue", "an unknown code passes through so it can still match");
  assert.equal(g.canonLang(""), "");
  assert.equal(g.canonLang(null), "");
});

test("a preference string becomes ordered canonical codes", () => {
  const { g } = boot();
  assert.equal(g.parseLangPref(" eng, EN, english ").join(","), "en");
  assert.equal(g.parseLangPref("fra; fre  fr").join(","), "fr");
  assert.equal(g.parseLangPref("").join(","), "");
});

test("a track matches by lang field, and titles only as a backstop", () => {
  const { g } = boot();
  assert.equal(g.trackMatchesLang({ lang: "eng" }, ["en"]), true);
  assert.equal(g.trackMatchesLang({ lang: "en-US", title: "" }, ["en"]), true);
  // IINA's formatted title often spells the language name out.
  assert.equal(g.trackMatchesLang({ lang: null, formattedTitle: "English" }, ["en"]), true);
  assert.equal(g.trackMatchesLang({ lang: null, title: "Movie.english.srt" }, ["en"]), true);
  // Short tokens are the title's own words far more often than a language.
  assert.equal(g.trackMatchesLang({ lang: null, title: "Ben.Hur.1959.mkv" }, ["bn"]), false,
    "'Ben' is a name, not Bengali");
  assert.equal(g.trackMatchesLang({ lang: null, title: "It.Follows.2014.en.srt" }, ["it"]), false,
    "'It' is a film, not Italian");
  assert.equal(g.trackMatchesLang({ lang: null, title: "when.srt" }, ["en"]), false,
    "a substring is not a match");
  assert.equal(g.trackMatchesLang({ lang: "eng" }, []), false);
});

test("SDH is a closed vocabulary, and 'hi' is Hindi", () => {
  const { g } = boot();
  assert.equal(g.sdhMarked({ title: "Show.S01E01.en.sdh.srt" }), true);
  assert.equal(g.sdhMarked({ title: "x", formattedTitle: "English (Hearing Impaired)" }), true);
  assert.equal(g.sdhMarked({ title: "Movie.en.hi.srt" }), true,
    "'hi' after a language tag is the hearing-impaired marking mpv itself reads");
  assert.equal(g.sdhMarked({ title: "Movie.hi.srt" }), false,
    "a 'hi' filename is Hindi, not hearing-impaired");
  assert.equal(g.sdhMarked({ title: "plain.srt" }), false);
  assert.equal(g.sdhMarked(null), false);
});

test("the SDH tiebreak only applies inside a language match", () => {
  const { g } = boot();
  const tracks = [
    { id: 1, lang: "eng", title: "English" },
    { id: 2, lang: "hin", title: "Hindi sdh" },          // SDH, but the wrong language
    { id: 3, lang: "eng", title: "Movie.en.sdh.srt" }
  ];
  assert.equal(g.pickTrack(tracks, ["en"], true).id, 3, "the SDH match did not win");
  assert.equal(g.pickTrack(tracks, ["en"], false).id, 1, "the first match should win without Prefer SDH");
  assert.equal(g.pickTrack(tracks, ["fr"], true), null, "an SDH track in another language matched");
});

// ── Applying the preference ─────────────────────────────────────────

test("the audio preference switches off a mismatched default", () => {
  const m = session({ audio: { tracks: [HINDI_AUDIO, ENGLISH_AUDIO] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "eng", subs: "", sdh: false });
  assert.equal(m.global.iina.core.audio.id, 2, "the Hindi default was left in play");
});

test("a language name or a short code both find the same track", () => {
  const nameSession = session({ audio: { tracks: [
    HINDI_AUDIO,
    { id: 2, lang: "en", title: "English 5.1", isSelected: false, isExternal: false }
  ]}});
  nameSession.fromWebView("sidebar", "setTrackPrefs", { audio: "english", subs: "", sdh: false });
  assert.equal(nameSession.global.iina.core.audio.id, 2);

  const codeSession = session({ audio: { tracks: [HINDI_AUDIO, ENGLISH_AUDIO] } });
  codeSession.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "", sdh: false });
  assert.equal(codeSession.global.iina.core.audio.id, 2);
});

test("an already-matching track is left alone", () => {
  const m = session({ audio: { tracks: [
    Object.assign({}, ENGLISH_AUDIO, { isSelected: true, isDefault: true }),
    HINDI_AUDIO
  ]}});
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "", sdh: false });
  assert.equal(m.global.iina.core.audio.id, null, "a track was switched for no reason");
});

test("no preference means no track is touched", () => {
  const m = session({
    audio: { tracks: [HINDI_AUDIO, ENGLISH_AUDIO] },
    subtitle: { tracks: [
      { id: 9, lang: "eng", title: "English", isSelected: false, isExternal: true, codec: "subrip" }
    ]}
  });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "", sdh: false });
  assert.equal(m.global.iina.core.audio.id, null);
  assert.equal(m.global.iina.core.subtitle.id, null);
});

test("a preference with no matching track leaves the default", () => {
  const m = session({ audio: { tracks: [HINDI_AUDIO, ENGLISH_AUDIO] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "fra", subs: "", sdh: false });
  assert.equal(m.global.iina.core.audio.id, null);
});

test("the subtitle preference applies, and SDH wins only when asked", () => {
  function subTracks(selectedId) {
    return [
      { id: 21, lang: "hin", title: "Hindi", isSelected: selectedId === 21, isExternal: false, codec: "subrip" },
      { id: 22, lang: "eng", title: "English", isSelected: selectedId === 22, isExternal: false, codec: "subrip" },
      { id: 23, lang: "eng", title: "Movie.en.sdh.srt", isSelected: selectedId === 23, isExternal: true, codec: "subrip" }
    ];
  }
  const plain = session({ subtitle: { tracks: subTracks(21) } });
  plain.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "en", sdh: false });
  assert.equal(plain.global.iina.core.subtitle.id, 22, "the plain English track should win without Prefer SDH");

  const sdh = session({ subtitle: { tracks: subTracks(21) } });
  sdh.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "en", sdh: true });
  assert.equal(sdh.global.iina.core.subtitle.id, 23, "Prefer SDH did not reach the SDH track");

  const upgrade = session({ subtitle: { tracks: subTracks(22) } });
  upgrade.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "en", sdh: true });
  assert.equal(upgrade.global.iina.core.subtitle.id, 23,
    "an already-correct plain track was not upgraded to SDH");

  const already = session({ subtitle: { tracks: subTracks(23) } });
  already.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "en", sdh: true });
  assert.equal(already.global.iina.core.subtitle.id, null, "an SDH track was switched again");
});

test("the selection finishes when a new file's tracks appear late", () => {
  const m = session({ audio: { tracks: [] }, subtitle: { tracks: [] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "eng", subs: "en", sdh: false });
  assert.equal(m.global.trackPickPending, true, "the retry window was closed with no tracks seen");

  const audio = m.global.iina.core.audio, subs = m.global.iina.core.subtitle;
  audio.tracks.push({ id: 7, lang: "eng", title: "English", isSelected: false });
  subs.tracks.push({ id: 8, lang: "eng", title: "English", isSelected: false, isExternal: true, codec: "subrip" });
  m.global.trackPrefsStep();
  assert.equal(audio.id, 7);
  assert.equal(subs.id, 8);
  assert.equal(m.global.trackPickPending, false, "the window stayed open after the answer");
});

test("file-loaded applies the preference, and a manual pick afterwards stands", () => {
  const m = session({ audio: { tracks: [] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "", sdh: false });
  const audio = m.global.iina.core.audio;
  audio.tracks.push({ id: 1, lang: "hin", title: "Hindi", isSelected: true });
  audio.tracks.push({ id: 2, lang: "eng", title: "English", isSelected: false });
  m.emit("iina.file-loaded");
  assert.equal(audio.id, 2, "the file opened on the wrong language");

  // The user reaches for the Hindi track anyway; nothing switches it back.
  audio.id = 1;
  audio.tracks[0].isSelected = true;
  audio.tracks[1].isSelected = false;
  m.global.trackPrefsStep();
  assert.equal(audio.id, 1, "a manual pick was overridden");
});

test("the retry window is bounded", () => {
  const m = session({ audio: { tracks: [] }, subtitle: { tracks: [] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "eng", subs: "", sdh: false });
  for (let i = 0; i < 12; i++) m.global.trackPrefsStep();
  assert.equal(m.global.trackPickPending, false, "the retry window never closed");
});

test("file-started retries the selection with a fresh window", () => {
  const m = session({ audio: { tracks: [] } });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "", sdh: false });
  m.global.trackPickTries = 99;
  m.global.trackPrefsStep();                       // the first window expires
  assert.equal(m.global.trackPickPending, false);

  const audio = m.global.iina.core.audio;
  audio.tracks.push({ id: 2, lang: "eng", title: "English", isSelected: false });
  m.emit("iina.file-started");
  assert.equal(audio.id, 2, "file-started did not reopen the window");
});

test("the mpv aid fallback runs when core.audio.id cannot be set", () => {
  const m = session({ audio: { tracks: [HINDI_AUDIO, ENGLISH_AUDIO] } });
  const audio = m.global.iina.core.audio;
  Object.defineProperty(audio, "id", {
    configurable: true,
    get() { return null; },
    set() { throw new Error("id is not settable"); }
  });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "", sdh: false });
  assert.equal(m.sink.mpvSet.aid, 2, "the mpv aid fallback did not run");
});

test("mpv's track-list stands in when the core track modules are absent", () => {
  const m = session({
    mpvNative: { "track-list": [
      { id: 1, type: "audio", lang: "hin", title: "Hindi", selected: true, default: true },
      { id: 2, type: "audio", lang: "eng", title: "English", selected: false },
      { id: 7, type: "sub", lang: "eng", title: "English", selected: false, external: true, codec: "subrip" }
    ]}
  });
  delete m.global.iina.core.audio;
  delete m.global.iina.core.subtitle;
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "en", subs: "en", sdh: false });
  assert.equal(m.sink.mpvSet.aid, 2, "the mpv audio list was not used");
  assert.equal(m.sink.mpvSet.sid, 7, "the mpv subtitle list was not used");
});

// ── The remembered subtitle copy ────────────────────────────────────

test("the cache name carries the SDH marker", () => {
  const { g } = boot();
  assert.match(g.subtitleCachePath(EPISODE, true), /^@data\/sidekick-sub-1399-1-2--sdh--\d+\.srt$/);
  assert.match(g.subtitleCachePath(EPISODE, false), /^@data\/sidekick-sub-1399-1-2--\d+\.srt$/);
  assert.equal(g.subtitleCachePath(null, true), "");
});

test("the prune understands both cache name shapes", () => {
  const { g } = boot();
  const files = [
    { name: "sidekick-sub-1399-1-2--sdh--100.srt" },
    { name: "sidekick-sub-1399-1-2--200.srt" },
    { name: "sidekick-sub-1399-1-2--sdh--300.srt" }
  ];
  assert.equal(g.subtitleFilesToPrune(files, 3).length, 0);
  assert.equal(g.subtitleFilesToPrune(files, 2).join(","),
    "@data/sidekick-sub-1399-1-2--sdh--100.srt",
    "the oldest cached subtitle was kept");
});

test("an SDH copy is loaded over a plain external track when asked", () => {
  const loads = [];
  const m = loadMain({
    status: { paused: false, duration: 4000, url: "file:///v/a.mkv" },
    subtitle: {
      tracks: [{ id: 1, isExternal: true, isSelected: true, codec: "subrip", title: "plain.en.srt", lang: "en" }],
      loadTrack: (p) => loads.push(p)
    },
    file: { list: () => [{ name: "sidekick-sub-1399-1-2--sdh--100.srt" }] }
  });
  m.emit("iina.window-loaded");
  m.runTimers();
  m.fromWebView("sidebar", "setDddKey", { key: "K" });
  m.fromWebView("sidebar", "setDddEnabled", { enabled: true });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "", sdh: true });
  m.fromWebView("sidebar", "episodeSelected", EPISODE);
  assert.equal(loads.length, 1, "the SDH copy was not loaded over a plain external subtitle");
  assert.equal(loads[0], "@data/sidekick-sub-1399-1-2--sdh--100.srt");
});

test("an already-SDH track is never replaced by the remembered copy", () => {
  const loads = [];
  const m = loadMain({
    status: { paused: false, duration: 4000, url: "file:///v/a.mkv" },
    subtitle: {
      tracks: [{ id: 1, isExternal: true, isSelected: true, codec: "subrip", title: "mine.en.SDH.srt", lang: "en" }],
      loadTrack: (p) => loads.push(p)
    },
    file: { list: () => [{ name: "sidekick-sub-1399-1-2--sdh--100.srt" }] }
  });
  m.emit("iina.window-loaded");
  m.runTimers();
  m.fromWebView("sidebar", "setDddKey", { key: "K" });
  m.fromWebView("sidebar", "setDddEnabled", { enabled: true });
  m.fromWebView("sidebar", "setTrackPrefs", { audio: "", subs: "", sdh: true });
  m.fromWebView("sidebar", "episodeSelected", EPISODE);
  assert.equal(loads.length, 0, "a working SDH track was overridden");
});

// ── The sidebar side ────────────────────────────────────────────────

test("the language fields store and push on change", () => {
  const h = loadSidebar({ storage: {} });
  h.global.doSetAudioLang(" eng, en ");
  assert.equal(h.localStorage.getItem("epinfo_audio_lang"), "eng, en");
  assert.equal(posted(h, "setTrackPrefs").pop().audio, "eng, en");

  h.global.doSetSubLang("en");
  h.global.doToggleSdh(true);
  const last = posted(h, "setTrackPrefs").pop();
  assert.equal(last.subs, "en");
  assert.equal(last.sdh, true);
  assert.equal(h.localStorage.getItem("epinfo_sdh"), "true");
  assert.equal(h.document.getElementById("sdh-toggle").checked, true);
});

test("boot pushes the saved language preferences", () => {
  const h = loadSidebar({ storage: {
    epinfo_audio_lang: "eng", epinfo_sub_lang: "en", epinfo_sdh: "true"
  }});
  h.timers._fireAll();
  const p = posted(h, "setTrackPrefs").pop();
  assert.equal(p.audio, "eng");
  assert.equal(p.subs, "en");
  assert.equal(p.sdh, true);
  assert.equal(h.document.getElementById("audio-lang-input").value, "eng");
  assert.equal(h.document.getElementById("sub-lang-input").value, "en");
  assert.equal(h.document.getElementById("sdh-toggle").checked, true);
});
