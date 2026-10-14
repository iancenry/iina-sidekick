#!/usr/bin/env node
// Sidekick logo audit.
//
// Samples the title treatments TMDB actually holds and prints what pickLogo's
// filter does with each one. The 2.5:1 aspect floor and the English-only rule
// in sidebar/identify.js were guesses; this exists so they can be re-tuned
// against real data instead. Read-only: it fetches and reports, nothing else.
//
//   TMDB_API_KEY=... node scripts/logo-audit.mjs "Fight Club" "Severance" tv:1399
//
// A bare title is searched; tv:1399 / movie:550 skips the search when the
// first result is ambiguous. The key comes from the environment or .env, like
// scripts/check-apis.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirrors pickLogo in sidebar/identify.js. If that filter changes, change this
// with it, or the audit starts reporting on a rule the plugin no longer uses.
const FILTER_ASPECT = 2.5;   // squarer than this is rejected outright
const WIDE_ASPECT   = 3;     // wide wordmarks get a small score bonus

function loadDotEnv() {
  let raw;
  try { raw = readFileSync(join(ROOT, ".env"), "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

const KEY = (process.env.TMDB_API_KEY || "").trim();
const args = process.argv.slice(2);

if (!KEY) {
  console.error("TMDB_API_KEY is required. Put it in .env or the environment.");
  process.exit(1);
}
if (!args.length) {
  console.error('usage: node scripts/logo-audit.mjs "Title" ... [tv:1399] [movie:550]');
  process.exit(1);
}

async function tmdb(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${KEY}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.status_message || "request failed"}`);
  return body;
}

// Resolve one argument to { kind, id, name }. An explicit tv:/movie: prefix
// skips the search entirely.
async function resolve(arg) {
  const direct = /^(tv|movie):(\d+)$/.exec(arg);
  if (direct) return { kind: direct[1], id: Number(direct[2]), name: arg };
  const found = await tmdb(`/search/multi?query=${encodeURIComponent(arg)}`);
  const hit = (found.results || []).find((x) => x.media_type === "tv" || x.media_type === "movie");
  if (!hit) throw new Error(`no TMDB result for "${arg}"`);
  return {
    kind: hit.media_type,
    id: Number(hit.id),
    name: hit.name || hit.title || arg,
    year: (hit.first_air_date || hit.release_date || "").slice(0, 4),
  };
}

// The same scoring rule pickLogo applies, reported per logo rather than
// reduced to a winner: every candidate gets a verdict.
function analyse(images) {
  const logos = (images && images.logos) || [];
  const rows = logos.filter((l) => l && l.file_path).map((l) => {
    const aspect = l.width && l.height ? l.width / l.height : (l.aspect_ratio || 0);
    const english = !l.iso_639_1 || l.iso_639_1 === "en";
    const passesAspect = l.aspect_ratio >= FILTER_ASPECT;
    let verdict = "candidate";
    if (!english) verdict = "rejected: language";
    else if (!passesAspect) verdict = "rejected: aspect";
    return {
      path: l.file_path,
      width: l.width, height: l.height,
      aspect, lang: l.iso_639_1 || "neutral",
      votes: l.vote_average || 0,
      score: (aspect >= WIDE_ASPECT ? 2 : 0) + (l.vote_average || 0),
      english, passesAspect, verdict,
    };
  });
  const candidates = rows.filter((r) => r.verdict === "candidate")
    .sort((a, b) => b.score - a.score);
  const near = rows.filter((r) => r.english && !r.passesAspect && r.aspect >= 2.0)
    .sort((a, b) => b.aspect - a.aspect);
  return { rows, candidates, near, pick: candidates[0] || null };
}

const fmt = (n) => Number.isFinite(n) ? n.toFixed(2) : "?";

let noPick = 0, nearMiss = 0;
for (const arg of args) {
  let resolved, detail;
  try {
    resolved = await resolve(arg);
    detail = await tmdb(`/${resolved.kind}/${resolved.id}?append_to_response=images`);
  } catch (err) {
    console.log(`\n${arg}: FAILED — ${err.message}`);
    continue;
  }
  const { kind, id, name, year } = resolved;
  const { rows, candidates, near, pick } = analyse(detail.images);
  console.log(`\n${name}${year ? ` (${year})` : ""} — ${kind} ${id}`);
  if (pick) {
    console.log(`  pick: ${pick.path}  ${pick.width}x${pick.height} (${fmt(pick.aspect)}:1)` +
      `  ${pick.lang}  votes ${pick.votes}`);
  } else {
    noPick++;
    const widest = rows.filter((r) => r.english).sort((a, b) => b.aspect - a.aspect)[0];
    console.log(`  pick: none — ${widest
      ? `widest English is ${fmt(widest.aspect)}:1 (${widest.path})`
      : "no English artwork at all"}`);
  }
  console.log(`  ${rows.length} logo(s): ${candidates.length} candidate(s),` +
    ` ${rows.filter((r) => r.verdict === "rejected: language").length} non-English,` +
    ` ${rows.filter((r) => r.verdict === "rejected: aspect").length} too square`);
  for (const r of candidates) {
    console.log(`    * ${r.path}  ${fmt(r.aspect)}:1  ${r.lang}  votes ${r.votes}  score ${fmt(r.score)}`);
  }
  if (near.length) {
    nearMiss += near.length;
    console.log(`  below the ${FILTER_ASPECT}:1 floor, English (the tuning candidates):`);
    for (const r of near) {
      console.log(`    - ${r.path}  ${r.width}x${r.height} (${fmt(r.aspect)}:1)  votes ${r.votes}`);
    }
  }
}

console.log(`\n${args.length} title(s): ${noPick} with no usable logo,` +
  ` ${nearMiss} English logo(s) just under the ${FILTER_ASPECT}:1 floor.`);
