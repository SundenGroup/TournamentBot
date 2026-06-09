// Public live-bracket pages and their JSON data feed.
//
//   GET /b/:id                 — Clutch-branded HTML page (OG tags injected)
//   GET /api/public/brackets/:id — sanitized tournament JSON, polled by the page
//
// No authentication: the tournament id is an unguessable UUID and the data is
// only exposed when the organizer enabled the Live Web Bracket toggle
// (settings.publicBracket, a Pro/Business feature) at creation.

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const { getTournament } = require('../services/tournamentService');

const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');

const router = express.Router();

const SERVICES = {
  single_elimination: singleElim,
  double_elimination: doubleElim,
  swiss,
  round_robin: roundRobin,
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
    id: p.id ?? null,
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
    title: tournament.title,
    description: tournament.description,
    status: tournament.status,
    startTime: tournament.startTime,
    game: {
      name: tournament.game.displayName,
      shortName: tournament.game.shortName,
      icon: tournament.game.icon,
      logo: tournament.game.logo,
    },
    format: tournament.settings.format,
    teamSize: tournament.settings.teamSize,
    bestOf: tournament.settings.bestOf,
    maxParticipants: tournament.settings.maxParticipants,
    participantCount: entrants.length,
    participants: entrants.map(e => ({
      name: isSolo ? (e.displayName || e.username) : e.name,
      seed: e.seed ?? null,
      checkedIn: !!e.checkedIn,
    })),
    bracket: tournament.bracket ? sanitize(tournament.bracket) : null,
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

async function loadPublicTournament(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  let value = null;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const tournament = await getTournament(id).catch(() => null);
    if (tournament && tournament.settings?.publicBracket) {
      value = buildPayload(tournament);
    }
  }

  cache.set(id, { ts: Date.now(), value });
  // Bounded: drop oldest entries past 500 tournaments
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// ============================================================================
// Routes
// ============================================================================

router.get('/api/public/brackets/:id', async (req, res) => {
  const payload = await loadPublicTournament(req.params.id);
  if (!payload) {
    return res.status(404).json({ error: 'Bracket not available' });
  }
  res.set('Cache-Control', 'public, max-age=5');
  res.json(payload);
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
  const payload = await loadPublicTournament(req.params.id);

  const title = payload ? `${payload.title} — Live Bracket` : 'Tournament Bracket';
  const desc = payload
    ? `${payload.game.name ?? 'Tournament'} • ${payload.participantCount}/${payload.maxParticipants} entrants • powered by CLUTCH`
    : 'Live tournament bracket powered by CLUTCH';

  const html = getTemplate()
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(desc))
    .replaceAll('{{BASE}}', escapeHtml(config.publicBaseUrl))
    .replaceAll('{{TOURNAMENT_ID}}', escapeHtml(req.params.id));

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
// buildPayload is exported for scripts/bracket-preview.js so local previews
// exercise the exact same payload pipeline as production.
module.exports.buildPayload = buildPayload;
