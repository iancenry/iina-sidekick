// ── Pick ──────────────────────────────────────────────────────
function pickItemByIndex(i) {
  var cache = document.getElementById("panel")._searchCache;
  if (!cache || !cache[i]) return;
  pickItem(cache[i]);
}

// Which pick is current. A show's detail request can outlive the pick that
// started it, and its response lands on whatever selShow is by then: a pick
// made while an earlier one was still loading painted one show's name and
// seasons onto the other's id.
var pickSeq = 0;

function pickItem(item) {
  selShow   = item;
  selSeason = null;
  episodeCache = [];
  showLogoUrl = "";
  showTotals = null;
  var seq = ++pickSeq;

  if (item.media_type === "movie") {
    document.getElementById("panel").innerHTML =
      '<div class="msg"><span class="sp"></span>Loading…</div>';
    fetch("https://api.themoviedb.org/3/movie/"+item.id+"?api_key="+TK+"&append_to_response=images")
      .then(function(r){return r.json();})
      .then(function(d){
        if (seq !== pickSeq) return;   // a newer pick owns the panel now
        if (!d || !d.title) {
          document.getElementById("panel").innerHTML = '<div class="msg">Failed to load.</div>';
          return;
        }
        var info = movieInfo(d);
        saveSelection(info);
        rememberFolderPin(info);   // a no-op for films, by design
      }).catch(function(){
        if (seq !== pickSeq) return;
        document.getElementById("panel").innerHTML='<div class="msg">Failed to load.</div>';
      });
    return;
  }

  document.getElementById("panel").innerHTML =
    '<div class="msg"><span class="sp"></span>Loading seasons…</div>';
  fetch("https://api.themoviedb.org/3/tv/"+item.id+"?api_key="+TK+"&append_to_response=images")
    .then(function(r){return r.json();})
    .then(function(show){
      if (seq !== pickSeq) return;   // a newer pick owns the panel now
      // The same dead end applyShowDetail guards against: an error body has no
      // seasons, which rendered a "Season" heading over zero pills.
      if (!show || !show.seasons) {
        resetPanel();
        return;
      }
      selShow._name    = show.name;
      selShow._seasons = (show.seasons||[]).filter(function(s){return s.season_number>0;});
      showLogoUrl      = pickLogo(show.images);
      // The show's own score, for episodes TMDB has no votes for.
      selShow._rating  = show.vote_average || 0;
      showTotals       = {
        seasons: show.number_of_seasons || selShow._seasons.length || null,
        episodes: show.number_of_episodes || null
      };
      renderSeasons();
    }).catch(function(){
      if (seq !== pickSeq) return;
      document.getElementById("panel").innerHTML='<div class="msg">Failed to load seasons.</div>';
    });
}

function renderSeasons() {
  if (!selShow||!selShow._seasons) return;
  paintSeasonShell(selSeason);
  if (selSeason!==null) renderEps(selSeason);
}

// The season pills, with `selected` lit, painted over an empty episode slot.
// Shared by the automatic and the manual path, and by the retry in renderEps:
// that retry moves the selection to the season the episode was actually found
// in, and a panel still lighting the season it started on would name a season
// the card below it does not belong to.
function paintSeasonShell(selected) {
  var pills = "";
  ((selShow && selShow._seasons) || []).forEach(function(s){
    pills += '<button class="pill'+(selected===s.season_number?" on":"")+
      '" onclick="pickSeason('+htmlEsc(String(s.season_number))+')">S'+
      htmlEsc(String(s.season_number).padStart(2,"0"))+'</button>';
  });
  document.getElementById("panel").innerHTML =
    '<div class="sec"><div class="sl">Season</div><div class="pills">'+pills+'</div></div>' +
    '<div id="ep"></div>';
}

function pickSeason(n){ selSeason=n; renderSeasons(); }

// autoEp: when set, the episode is picked automatically as soon as the list
// loads. This is what the filename-detection path uses.
//
// retrySeason: the other season to try before leaving the pills up — the one
// the filename assumed when the folder's remembered season was used, or the
// folder's season when the filename's was. Long-running series are numbered
// straight through by their sources while TMDB splits them into seasons, so
// the number often sits in one of the two and not the other.
//
// quiet marks that second look: it paints nothing and stores nothing, because
// the pills already on screen index into the season it is *not* showing, and a
// miss has to leave them exactly as they were.
function renderEps(sNum, autoEp, token, retrySeason, quiet) {
  var el = document.getElementById("ep");
  if (!el) return;
  var retry = (typeof retrySeason === "number" && retrySeason > 0) ? retrySeason : null;
  if (!quiet) el.innerHTML = '<div class="msg"><span class="sp"></span>Loading episodes…</div>';
  fetch("https://api.themoviedb.org/3/tv/"+selShow.id+"/season/"+sNum+"?api_key="+TK)
    .then(function(r){return r.json();})
    .then(function(s){
      if (!tokenLive(token)) return;
      // A season that 404s, or an auth failure, resolves with a body carrying
      // no episodes. Rendering "Episode" above an empty pill row is a dead
      // end with no way out, so say so instead. Tested on the field actually
      // used below, not on an id nothing reads.
      if (!s || !s.episodes) {
        if (!quiet) el.innerHTML = '<div class="msg">Couldn\'t load that season. Search again above.</div>';
        return;
      }
      // Worked on locally until this season is the one being kept. The season
      // poster and the cached list are what the pills on screen index into, so
      // a look that misses must not leave them behind.
      var eps = s.episodes || [];
      var poster = s.poster_path
        ? IW + s.poster_path
        : (selShow && selShow.poster_path ? IW + selShow.poster_path : "");

      var idx = -1;
      if (autoEp) {
        for (var i = 0; i < eps.length; i++) {
          if (eps[i].episode_number === autoEp) { idx = i; break; }
        }
      }

      if (idx < 0) {
        // The number is not here. A quiet look has nothing to say about that.
        if (quiet) return;
        episodeCache = eps;
        seasonPosterUrl = poster;
        selSeason = sNum;
        // Painted before the second look, because these are the pills the user
        // is left with if that look misses too: the season the file was read
        // from, which is the one the panel already lights.
        paintEpisodes(sNum, autoEp, eps);
        if (retry !== null && retry !== sNum && hasSeason(retry)) {
          renderEps(retry, autoEp, token, null, true);
        }
        return;
      }

      // FIX: Cache episodes in a plain JS array. Buttons use integer
      // indices only, with no JSON or encoding in onclick attributes.
      // Previously, ep.name/ep.overview with " characters would corrupt
      // the onclick HTML and silently disable specific episode buttons.
      episodeCache = eps;
      seasonPosterUrl = poster;
      selSeason = sNum;
      // A quiet look that found the episode moves the panel to that season
      // before the pick, so nothing on screen names the season it left.
      if (quiet) paintSeasonShell(sNum);
      pickEp(idx, true);
    }).catch(function(){
      if (!tokenLive(token)) return;
      if (!quiet) el.innerHTML='<div class="msg">Failed to load episodes.</div>';
    });
}

// The episode pills, and the note that stands in for them when the number the
// filename gave is not among them. Built from the list passed in rather than
// from episodeCache, so a quiet look cannot paint the wrong season's episodes.
function paintEpisodes(sNum, autoEp, eps) {
  var el = document.getElementById("ep");
  if (!el) return;
  var pills = "";
  eps.forEach(function(ep, i){
    // The number is escaped too, though it is a number: this is the only
    // dynamic value besides the tooltip that reaches the markup, and a
    // hand-edited stored entry is not the only possible source.
    var label = "E" + String(ep.episode_number).padStart(2,"0");
    // Use htmlEsc for tooltip; no data at all in onclick
    pills += '<button class="pill" title="'+htmlEsc(ep.name||"")+
      '" onclick="pickEp('+i+')">'+htmlEsc(label)+'</button>';
  });
  if (autoEp) {
    // Episode not in this season (bad parse, or season mismatch).
    // Leave the pills up so the user can correct it in one click.
    el.innerHTML = '<div class="msg" style="padding:6px 0">'
      + htmlEsc(selShow._name || "") + ' has no episode '
      + htmlEsc(String(autoEp)) + ' in season ' + htmlEsc(String(sNum))
      + ': pick below.</div>' +
      '<div class="sec" style="margin-top:8px"><div class="pills">'+pills+'</div></div>';
    return;
  }
  el.innerHTML =
    '<div class="sec" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)">' +
    '<div class="sl">Episode</div><div class="pills">'+pills+'</div></div>';
}

// Whether a season the show actually has can be asked for at all. A pin
// outlives the season list it was written against, and a season that is gone
// would end in a 404 page rather than the pills.
function hasSeason(n) {
  return !!(selShow && selShow._seasons && selShow._seasons.some(function(s){
    return s.season_number === n;
  }));
}

// The release year out of a TMDB date string, used wherever one is needed.
function yearOf(dateStr) {
  var m = /(19|20)\d{2}/.exec(String(dateStr || ""));
  return m ? m[0] : "";
}

function epCode(s, e) {
  return "S" + String(s).padStart(2, "0") + "E" + String(e).padStart(2, "0");
}

// Where this episode sits, and when the next one is due. Both figures come
// out of the season response the picker already fetched, so showing them costs
// no extra round trip.
function seriesContext(sNum, ep) {
  var bits = [];
  if (showTotals) {
    bits.push("Season " + sNum + (showTotals.seasons ? " of " + showTotals.seasons : ""));
  }
  // Only claim a total when the episode really is inside it: a season that
  // TMDB lists partially would otherwise render "Episode 3 of 2".
  if (episodeCache.length && ep.episode_number <= episodeCache.length) {
    bits.push("Episode " + ep.episode_number + " of " + episodeCache.length);
  }
  var i = episodeCache.indexOf(ep);
  var next = i >= 0 ? episodeCache[i + 1] : null;
  if (next) {
    bits.push("Next " + epCode(sNum, next.episode_number) + (next.air_date ? " " + next.air_date : ""));
  }
  return bits.join("  ·  ");
}

// FIX: pickEp now takes an integer index, not an encoded JSON string.
// `auto` marks a pick the plugin made for itself rather than one the user
// clicked. Only a click counts as evidence the user endorses the pairing, so
// only a click is allowed to pin a folder.
function pickEp(idx, auto) {
  var ep = episodeCache[idx];
  if (!ep) return;
  // selShow is cleared on every file change, so a season response that lands
  // late can reach here with nothing to describe. Previously that threw, and
  // the rejection was absorbed by renderEps' catch, which turned a real bug
  // into silence.
  if (!selShow) return;
  // An episode TMDB has no votes for carries vote_average 0, and a blank star
  // was all the card showed. The show's score arrived with the detail response
  // already in hand, so it stands in, marked as the series figure so an
  // episode's own score is never confused with the show's.
  var ownRating  = ep.vote_average || 0;
  var showRating = selShow._rating || 0;
  var info = {
    showTitle: selShow._name||selShow.name||"",
    epTitle:   ep.name||("Episode "+ep.episode_number),
    code:      epCode(selSeason, ep.episode_number),
    context:   seriesContext(selSeason, ep),
    airDate:   ep.air_date||"",
    rating:    (ownRating || showRating) ? (ownRating || showRating).toFixed(1) : "",
    ratingNote: (!ownRating && showRating) ? "series" : "",
    overview:  ep.overview||"",
    // The episode's own still beats the season poster, which repeats on every
    // episode of the season. Falls back to the season poster, then the show's.
    posterUrl: ep.still_path ? IW + ep.still_path
             : (seasonPosterUrl || (selShow && selShow.poster_path ? IW + selShow.poster_path : "")),
    logoUrl: showLogoUrl,
    tmdbId: String(selShow.id), season: selSeason, episode: ep.episode_number, isMovie: false,
    // The absolute number this entry was derived from, or null when the
    // filename carried none. S21E62 cannot be compared with "[1062-1063]"
    // without the show's season totals, which are not loaded here, so the
    // number that produced the entry is recorded instead. See the staleness
    // check in the fileChanged handler.
    absoluteFrom: currentParsed ? (currentParsed.absolute || null) : null,
    // What the filename itself claimed, which is not always what is saved: the
    // user can correct a season by hand, and a pinned folder can supply one.
    // Recorded for the same reason as absoluteFrom above, so that a re-play
    // compares the entry against the file it was built from instead of against
    // the pick — a saved S02E41 on a file that reads S01E41 is the correction,
    // not a stale entry. Null when the filename named neither, and left
    // undefined by entries written before the field existed.
    parsedSeason:  currentParsed && currentParsed.code ? currentParsed.code.season : null,
    parsedEpisode: currentParsed && currentParsed.code ? currentParsed.code.episode : null
  };
  // Captured now, from the parse and the pick in hand, rather than read from
  // the module later: a response that arrives after the user has moved on must
  // not pin the folder of the file playing by then.
  var pickDir = pinDirFor(currentParsed, info);
  saveSelection(info);
  if (!auto) rememberFolderPin(info, pickDir);
}

// Which directory a manual pick should pin, or "" when none looks safe.
//
// The directory that supplied the title is always worth remembering. When the
// filename supplied its own, the walk's directory is still used, but only when
// the show the user picked is not the one the filename named: a filename that
// did name the show has already been trusted with the identification, and the
// directory above it is the media folder as often as it is the show. That is
// what makes the shape pinning exists for work — "AnimePahe Bleach - Sennen
// Kessen-hen - 41" names neither the show nor anything TMDB has, so the folder
// beside it is the only thing that did.
function pinDirFor(parsed, info) {
  if (!parsed || !info || !info.showTitle) return "";
  if (parsed.titleDir) return parsed.titleDir;
  if (!parsed.folderDir) return "";
  if (titleScore(parsed.title, info.showTitle) >= AUTO_MIN_SCORE) return "";
  return parsed.folderDir;
}

// Record "this directory is that show", so every other file in it stops
// needing the guesswork. Called from manual picks only: an automatic match is
// not evidence the user would have chosen it, and a wrong pin would then apply
// to every remaining file in the folder.
function rememberFolderPin(info, dir) {
  if (!info || info.isMovie) return;
  try {
    if (localStorage.getItem("epinfo_pin_remember") === "false") return;
  } catch (e) { return; }
  // Only a directory that supplied the title is worth pinning. In a flat
  // library the parent is usually the whole media folder, and pinning that to
  // one show would be actively wrong. The directory is passed in by the caller
  // rather than read from the module, so a late response cannot pin whatever
  // folder happens to be playing now.
  if (!dir) return;
  var m = loadFolderMap();
  m[dir] = {
    tmdbId: String(info.tmdbId || ""),
    name: info.showTitle || "",
    season: info.season,
    lastSeen: Date.now()
  };
  saveFolderMap(m);
  paintPinState();
}

// Reflect the pin, if any, for the file that is playing now.
function paintPinState() {
  var el = document.getElementById("pin-state");
  if (!el) return;
  var pin = currentVideoUrl ? pinForUrl(currentVideoUrl) : null;
  if (!pin) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "block";
  el.innerHTML = '<span class="pin-lbl">Folder pinned to <b>' + htmlEsc(pin.show.name || "?")
    + '</b></span>'
    + '<button class="pin-x" onclick="doUnpinFolder()" title="Forget this folder">\u2715</button>';
}

function doUnpinFolder() {
  invalidateLookups();
  var pin = currentVideoUrl ? pinForUrl(currentVideoUrl) : null;
  if (pin) unpinFolder(pin.dir);
  paintPinState();
  // Forget the identification too, so the very next play re-derives it rather
  // than replaying the pick the pin was standing in for.
  clearCurrentUrlFromMap();
  try { localStorage.removeItem("epinfo_ep"); } catch (e) {}
  document.getElementById("saved").classList.remove("on");
  selShow = null; selSeason = null; episodeCache = []; showTotals = null;
  iina.postMessage("clearEpisode", {});
  resetPanel();
  autoIdentify(currentVideoUrl);
}

function doSetPinRemember(on) {
  try { localStorage.setItem("epinfo_pin_remember", on ? "true" : "false"); } catch (e) {}
}

function saveSelection(info) {
  try{localStorage.setItem("epinfo_ep", JSON.stringify(info));}catch(e){}
  saveCurrentUrlInfo(info); // remember per-URL
  pushRecent(info);         // and to the recent picks list
  showSaved(info);
  // The marks for this identification travel ahead of the selection, so the
  // cue pipeline has them by the time it resolves.
  iina.postMessage("setSceneMarks", { marks: marksFor(info) });
  iina.postMessage("episodeSelected", info);
  if (typeof paintMarks === "function") paintMarks();
  document.getElementById("panel").innerHTML =
    '<div class="ok" style="padding:8px 0">✓ Saved</div>';
  selShow      = null;
  selSeason    = null;
  episodeCache = [];
}
