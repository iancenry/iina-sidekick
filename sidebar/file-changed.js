// ── File changed ──────────────────────────────────────────────
// A season or an episode as the staleness comparison needs it. Null stays
// null — a season pack names no episode, and a saved episode number must not
// be compared against a zero it never was — while a stored string ("2") and a
// stored number (2) compare equal, because a hand-edited entry is not the
// only way a string gets in there.
function codeNum(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// URL-aware. A URL we've already identified restores instantly, but only
// if the remembered episode still agrees with the filename. A stale entry
// (typically a mis-pick saved against the wrong file) is re-identified
// rather than silently replayed.
iina.onMessage("fileChanged", function(d){
  var nextUrl = (d && d.url) || "";
  // A repeat of the message for the file already playing is a no-op, and it
  // has to be: main.js re-sends this on the sidebar-ready handshake. Returning
  // here is what leaves the in-flight lookup's timer and its eventual result
  // intact. Treating it as a fresh event cancelled the timer, and the lookup
  // then abandoned its own result because the timer it was waiting on had
  // gone, so the file silently failed to identify.
  if (nextUrl === currentVideoUrl) return;
  currentVideoUrl = nextUrl;
  invalidateLookups();
  // A half-finished mark belongs to the file that was playing; carrying a
  // pending trigger or an armed clear into the next one would attach it to
  // the wrong title.
  if (typeof resetMarkUiState === "function") resetMarkUiState();

  // Reset search panel state regardless
  document.getElementById("q").value = "";
  selShow = null; selSeason = null; episodeCache = []; resetPanel();
  paintPinState();

  var map   = loadUrlMap();
  var saved = currentVideoUrl ? map[currentVideoUrl] : null;

  // Parsed unconditionally, not only when there is something cached: the pin
  // writer needs to know which directory supplied the title, and a lazy parse
  // would leave it working from whichever file happened to be parsed last.
  var now = parseFilename(currentVideoUrl);

  // The filename is ground truth for season/episode, and for a film's year;
  // the cache is only authoritative about which show it is.
  var stale = false;
  if (saved) {
    if (now && now.code) {
      // Compared against what the filename claimed when the entry was written,
      // where the entry records it. A season the user corrected by hand, or
      // one a pinned folder supplied, is not evidence that this is a different
      // file: comparing against the saved pick re-identified the correction on
      // every return, and it could never be kept. Entries written before the
      // field existed fall back to the saved pick and are re-identified once,
      // exactly as they are for absoluteFrom.
      var refSeason  = saved.parsedSeason === undefined ? saved.season : saved.parsedSeason;
      var refEpisode = saved.parsedEpisode === undefined ? saved.episode : saved.parsedEpisode;
      stale = codeNum(refSeason)  !== codeNum(now.code.season) ||
              codeNum(refEpisode) !== codeNum(now.code.episode);
      // An entry filed under a season the folder disagrees with cannot be
      // trusted either, where the filename never said which season it was: the
      // folder's season is what the entry should have, and a disagreement means
      // it was written before the pin existed, or under a pick that has since
      // been replaced. A pick made by hand rewrites the pin, so a correction
      // the user made never lands here; this is what retires an episode saved
      // as the wrong one of the two.
      if (!stale && !now.code.seasonFromName && !now.code.seasonFromFolder) {
        var folderPin = pinForUrl(currentVideoUrl);
        if (folderPin && folderPin.show.season &&
            Number(folderPin.show.season) !== Number(saved.season)) {
          stale = true;
        }
      }
    } else if (now && now.absolute) {
      // An absolute number is ground truth for the episode too, but S21E62
      // cannot be compared with "[1062-1063]" without the show's season totals,
      // which are not loaded here and would cost a request on every replay.
      // The entry records the number it was built from instead. An entry
      // written before that field existed has nothing to compare, so it is
      // re-identified once, exactly as a missing logoUrl or context is.
      stale = (saved.absoluteFrom === undefined) || saved.absoluteFrom !== now.absolute;
    } else if (now && now.isMovie && saved.isMovie) {
      // A film identified under a different year is the wrong film.
      stale = yearOf(saved.airDate || saved.code) !== yearOf(now.year);
    } else if (now && now.isMovie && !saved.isMovie) {
      stale = true;   // an episode identification on a film
    }
    // An entry with no logoUrl key at all was saved before title treatments
    // existed, so it would restore as plain text forever. Re-identify once:
    // the refreshed entry always has the key, empty or not, and a title with
    // genuinely no logo refreshes only this one time.
    if (saved.logoUrl === undefined) stale = true;
    // Same for the series context line, added later. Both writers now always
    // store the key. A film stores an empty string, exactly as it does for
    // logoUrl, so an absent key means only one thing: an entry written
    // before the field existed.
    if (saved.context === undefined) stale = true;
  }

  if (saved && !stale) {
    // URL is already identified and still correct, so restore it silently.
    try { localStorage.setItem("epinfo_ep", JSON.stringify(saved)); } catch(e) {}
    saveCurrentUrlInfo(saved);   // refresh lastSeen so it never ages out
    showSaved(saved);
    iina.postMessage("setSceneMarks", { marks: marksFor(saved) });
    iina.postMessage("episodeSelected", saved);
    if (typeof paintMarks === "function") paintMarks();
  } else {
    // The new file's identity is not known yet, so the previous one must not
    // stay live while the lookup runs. It used to, deliberately, so the card
    // would not blink; but the marks capture reads epinfo_ep, and a mark added
    // during that window (up to the 25s deadline) was stored against the
    // previous episode, with the previous card on screen over a file it did
    // not describe. autoIdentify repaints both the moment it lands.
    try { localStorage.removeItem("epinfo_ep"); } catch(e) {}
    document.getElementById("saved").classList.remove("on");
    iina.postMessage("setSceneMarks", { marks: [] });
    iina.postMessage("clearEpisode", {});
    if (typeof paintMarks === "function") paintMarks();
    // False means the filename holds nothing to search by, and the manual
    // prompt above is the whole outcome.
    autoIdentify(currentVideoUrl);
  }
});
