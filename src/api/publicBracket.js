// Public live-bracket pages and their JSON data feed.
//
//   GET /b/:id                 — Clutch-branded HTML page (OG tags injected)
//   GET /api/public/brackets/:id — sanitized tournament JSON, polled by the page
//
// No authentication: the tournament id is an unguessable UUID (organizers can
// opt into a memorable custom slug — public by intent) and the data is only
// exposed when the organizer enabled the Live Web Bracket toggle
// (settings.publicBracket, a Pro/Business feature) at creation.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { getTournament } = require('../services/tournamentService');
const { countRealResults } = require('../utils/matchUtils');

/**
 * Opaque, stable key for a participant. The browser only needs to match a
 * match's winner to a slot — it must NOT receive raw Discord user/team IDs.
 * Hashing keeps matching working while never exposing snowflakes publicly.
 */
function opaqueId(id) {
  if (id == null) return null;
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
}

const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');

const router = express.Router();

const SERVICES = {
  single_elimination: singleElim,
  double_elimination: doubleElim,
  swiss,
  round_robin: roundRobin,
  battle_royale: battleRoyale,
};

// ============================================================================
// Sanitizing — never leak Discord internals (channel ids, member lists) to the
// public page; participants are reduced to display name + seed.
// ============================================================================

const PARTICIPANT_KEYS = new Set(['participant1', 'participant2', 'winner', 'loser', 'participant']);
const DROPPED_KEYS = new Set(['channelId', 'members', 'captain', 'memberCheckins', 'opponents', 'headToHead']);

function sanitizeParticipant(p) {
  if (!p) return null;
  return {
    id: opaqueId(p.id),
    name: p.name || p.displayName || p.username || 'TBD',
    seed: p.seed ?? null,
  };
}

function sanitize(node) {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED_KEYS.has(key)) continue;
      out[key] = PARTICIPANT_KEYS.has(key) ? sanitizeParticipant(value) : sanitize(value);
    }
    return out;
  }
  return node;
}

/**
 * Battle Royale gets an explicitly-built payload instead of the generic
 * sanitizer: BR standings hold full team objects under keys the sanitizer
 * doesn't treat as participants, which would leak raw ids and private
 * gameFields. Building the shape by hand means nothing leaks by omission.
 */
function buildBRPayload(bracket) {
  const usesKills = (bracket.scoring?.killPoints || 0) > 0 || !!bracket.scoring?.killMultipliers;

  const stagePayload = (stage) => ({
    name: stage.name,
    gamesTotal: stage.games.length,
    gamesComplete: stage.games.filter(g => g.status === 'complete').length,
    games: stage.games.map(g => ({ gameNumber: g.gameNumber, status: g.status })),
    standings: stage.standings.map((s, i) => ({
      rank: i + 1,
      name: s.team.name || s.team.username || 'Unknown',
      points: s.points,
      kills: s.kills,
      wins: s.wins,
      gamesPlayed: s.gamesPlayed,
      placements: s.placements,
      qualifiedFrom: s.team.qualifiedFrom || null,
      // Per-game breakdown for the results matrix: {p: placement|null (unplaced),
      // k: kills, pts: points} per game, null while a game is pending.
      perGame: stage.games.map(g => {
        if (g.status !== 'complete') return null;
        const r = (g.results || []).find(x => x.teamId === s.team.id);
        return r ? { p: r.placement, k: r.kills, pts: r.points } : null;
      }),
    })),
  });

  return {
    type: 'battle_royale',
    currentStage: bracket.currentStage,
    singleLobby: !!bracket.singleLobby,
    advancingPerGroup: bracket.advancingPerGroup || 0,
    gamesPerStage: bracket.gamesPerStage,
    scoring: {
      label: bracket.scoring?.label || 'Placement points',
      usesKills,
    },
    groups: bracket.groups.map(stagePayload),
    finals: bracket.finals ? stagePayload(bracket.finals) : null,
  };
}

function buildPayload(tournament) {
  const isSolo = tournament.settings.teamSize === 1;
  const entrants = isSolo ? tournament.participants : tournament.teams;

  let results = null;
  if (tournament.bracket) {
    const service = SERVICES[tournament.bracket.type];
    try {
      if (service && service.isComplete(tournament.bracket)) {
        const raw = service.getResults(tournament.bracket);
        if (raw) {
          results = {
            winner: sanitizeParticipant(raw.winner),
            runnerUp: sanitizeParticipant(raw.runnerUp),
            thirdPlace: sanitizeParticipant(raw.thirdPlace),
          };
        }
      }
    } catch {
      // results stay null — page falls back to bracket view
    }
  }

  return {
    id: tournament.id,
    // Custom /b/ link, when set — uuid URLs 301 to it
    slug: tournament.settings.publicSlug || null,
    title: tournament.title,
    description: tournament.description,
    status: tournament.status,
    // Deferred rooms: bracket published, play not started — page shows a
    // "starting soon" pill instead of ● Live. A MID-event room hold (results
    // already exist) is admin plumbing and doesn't change the public pill.
    roomsPending: !!(tournament.bracket?.roomsPending && countRealResults(tournament.bracket) === 0),
    startTime: tournament.startTime,
    game: {
      name: tournament.game.displayName,
      shortName: tournament.game.shortName,
      icon: tournament.game.icon,
      logo: tournament.game.logo,
    },
    format: tournament.settings.format,
    // Group tables show the GD column from the start when goals are tracked
    trackGoals: tournament.settings.trackGoals !== false,
    teamSize: tournament.settings.teamSize,
    bestOf: tournament.settings.bestOf,
    maxParticipants: tournament.settings.maxParticipants,
    // Overflow signups: more can register than there are spots; the page
    // switches from "N/max" to "N signed up · max spots" pre-start.
    signupCap: tournament.settings.signupCap ?? null,
    participantCount: entrants.length,
    participants: entrants.map(e => ({
      name: isSolo ? (e.displayName || e.username) : e.name,
      seed: e.seed ?? null,
      checkedIn: !!e.checkedIn,
      disqualified: !!e.disqualified,
    })),
    bracket: tournament.bracket
      ? (tournament.bracket.type === 'battle_royale' ? buildBRPayload(tournament.bracket) : sanitize(tournament.bracket))
      : null,
    results,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Small response cache — the page polls every 15s and events can have many
// viewers; one DB/store read per tournament per 5s is plenty.
// ============================================================================

const cache = new Map();
const CACHE_TTL_MS = 5000;

async function loadPublicEntry(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit;

  let value = null;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const tournament = await getTournament(id).catch(() => null);
    if (tournament && tournament.settings?.publicBracket) {
      value = buildPayload(tournament);
    }
  }

  // Serialize + hash + GZIP once per TTL, not once per request — at 512
  // entrants the JSON is ~500 KB and thousands of viewers re-download it the
  // moment a result lands. Compressing per response would cost ~15 ms CPU
  // each; serving this pre-gzipped buffer costs ~0.
  const body = value ? JSON.stringify(value) : null;
  const etag = body ? `W/"${crypto.createHash('sha1').update(body).digest('base64').slice(0, 27)}"` : null;
  const gz = body ? zlib.gzipSync(body) : null;

  const entry = { ts: Date.now(), value, body, etag, gz };
  cache.set(id, entry);
  // Bounded: drop oldest entries past 500 tournaments
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return entry;
}

async function loadPublicTournament(id) {
  return (await loadPublicEntry(id)).value;
}

// ── Custom slug resolution ──────────────────────────────────────────────────
// /b/<slug> serves the page; the uuid URL and every PAST slug 301 to the
// current identifier, so shared links never die. Postgres jsonb lookups with
// a small TTL cache (a slug change propagates within 30s).

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SLUG_TTL_MS = 30000;
const slugCache = new Map(); // slug → { ts, uuid, current }

async function resolveSlug(slug) {
  const hit = slugCache.get(slug);
  if (hit && Date.now() - hit.ts < SLUG_TTL_MS) return hit;

  let uuid = null;
  let current = false;
  const row = await db('tournaments').whereRaw(`settings->>'publicSlug' = ?`, [slug]).first('id').catch(() => null);
  if (row) {
    uuid = row.id;
    current = true;
  } else {
    const past = await db('tournaments').whereRaw(`settings->'pastSlugs' \\? ?`, [slug]).first('id').catch(() => null);
    if (past) uuid = past.id;
  }

  const entry = { ts: Date.now(), uuid, current };
  slugCache.set(slug, entry);
  if (slugCache.size > 1000) slugCache.delete(slugCache.keys().next().value);
  return entry;
}

/** → { uuid|null, redirect: '/b/…'|null } for any /b/:id identifier. */
async function resolvePublicId(idOrSlug) {
  if (UUID_RE.test(idOrSlug)) {
    const entry = await loadPublicEntry(idOrSlug);
    const slug = entry.value?.slug || null;
    return { uuid: idOrSlug, redirect: slug ? `/b/${slug}` : null };
  }
  const s = await resolveSlug(idOrSlug.toLowerCase());
  if (!s.uuid) return { uuid: null, redirect: null };
  if (s.current) return { uuid: s.uuid, redirect: null };
  const entry = await loadPublicEntry(s.uuid);
  return { uuid: s.uuid, redirect: `/b/${entry.value?.slug || s.uuid}` };
}

// ============================================================================
// Routes
// ============================================================================

router.get('/api/public/brackets/:id', async (req, res) => {
  let id = req.params.id;
  if (!UUID_RE.test(id)) {
    const s = await resolveSlug(id.toLowerCase());
    if (!s.uuid) return res.status(404).json({ error: 'Bracket not available' });
    id = s.uuid;
  }
  const entry = await loadPublicEntry(id);
  if (!entry.body) {
    return res.status(404).json({ error: 'Bracket not available' });
  }
  res.set('Cache-Control', 'public, max-age=5');
  res.set('ETag', entry.etag);
  res.set('Vary', 'Accept-Encoding');
  // Unchanged bracket → empty 304 instead of re-sending ~500 KB per poll
  if (req.headers['if-none-match'] === entry.etag) {
    return res.status(304).end();
  }
  // Pre-compressed buffer (Content-Encoding set here → the compression
  // middleware sees it and skips re-compressing)
  if (entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.set('Content-Encoding', 'gzip');
    return res.type('application/json').send(entry.gz);
  }
  res.type('application/json').send(entry.body);
});

// HTML shell with OG tags injected so Discord/social links unfurl nicely.
const templatePath = path.join(__dirname, '../../public/bracket.html');
let templateCache = null;
function getTemplate() {
  if (!templateCache || process.env.NODE_ENV === 'development') {
    templateCache = fs.readFileSync(templatePath, 'utf8');
  }
  return templateCache;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

router.get('/b/:id', async (req, res) => {
  // Custom slugs: uuid URLs and past slugs 301 to the current link — shared
  // links keep working forever. Query string (e.g. ?stage=groups) rides along.
  const resolved = await resolvePublicId(req.params.id);
  if (resolved.redirect) {
    const q = req.originalUrl.indexOf('?');
    return res.redirect(301, resolved.redirect + (q === -1 ? '' : req.originalUrl.slice(q)));
  }
  const dataId = resolved.uuid || req.params.id;
  const payload = resolved.uuid ? await loadPublicTournament(resolved.uuid) : null;

  const title = payload ? `${payload.title} — Live Bracket` : 'Tournament Bracket';
  const overflowOpen = payload && (payload.signupCap || 0) > payload.maxParticipants &&
    (payload.status === 'registration' || payload.status === 'checkin');
  const desc = payload
    ? `${payload.game.name ?? 'Tournament'} • ${overflowOpen
        ? `${payload.participantCount} signed up · ${payload.maxParticipants} spots`
        : `${payload.participantCount}/${payload.maxParticipants} entrants`} • powered by CLUTCH`
    : 'Live tournament bracket powered by CLUTCH';

  const html = getTemplate()
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(desc))
    .replaceAll('{{BASE}}', escapeHtml(config.publicBaseUrl))
    .replaceAll('{{DATA_URL}}', `/api/public/brackets/${escapeHtml(dataId)}`)
    .replaceAll('{{TOURNAMENT_ID}}', escapeHtml(dataId));

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
// buildPayload is exported for scripts/bracket-preview.js so local previews
// exercise the exact same payload pipeline as production.
module.exports.buildPayload = buildPayload;
