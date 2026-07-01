// Web-admin dashboard (Phase 0-1: read-only).
//
//   GET /admin                          → dashboard page (Clutch-branded)
//   GET /admin/api/me                   → session user + manageable guilds
//   GET /admin/api/guilds/:guildId/tournaments → tournaments in a managed guild
//   GET /admin/api/tournaments/:id      → full tournament data (admin-scoped)
//   GET /admin/b/:id                    → the live bracket page, wired to the
//                                          admin data feed (used in an iframe)

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const { requireSession, requireGuildAdmin, requireCsrf, adminRateLimit, csrfToken } = require('./adminAuth');
const { getTournament, getTournamentsByGuild } = require('../services/tournamentService');
const { buildPayload } = require('./publicBracket');

const router = express.Router();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Dashboard page ───────────────────────────────────────────────────────────
router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin-dashboard.html'));
});

// ── Session / identity ───────────────────────────────────────────────────────
router.get('/admin/api/me', requireSession, (req, res) => {
  res.json({
    user: { id: req.session.uid, username: req.session.username, avatar: req.session.avatar },
    guilds: req.session.guilds,
    csrf: csrfToken(req.session),
  });
});

// ── Tournaments in a managed guild ───────────────────────────────────────────
router.get('/admin/api/guilds/:guildId/tournaments', requireSession, requireGuildAdmin, async (req, res) => {
  try {
    const tournaments = await getTournamentsByGuild(req.params.guildId);
    const list = tournaments
      .map(t => {
        const isSolo = t.settings.teamSize === 1;
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          game: t.game?.displayName || 'Custom',
          gameLogo: t.game?.logo || null,
          format: t.settings.format,
          teamSize: t.settings.teamSize,
          bestOf: t.settings.bestOf,
          entrants: (isSolo ? t.participants : t.teams).length,
          maxParticipants: t.settings.maxParticipants,
          startTime: t.startTime,
          createdAt: t.createdAt,
          publicBracket: !!t.settings.publicBracket,
        };
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ tournaments: list });
  } catch (err) {
    console.error('[web-admin] list tournaments error:', err.message);
    res.status(500).json({ error: 'Failed to load tournaments' });
  }
});

/** Load a tournament and verify the session manages its guild. */
async function loadOwnedTournament(req) {
  const t = await getTournament(req.params.id).catch(() => null);
  if (!t) return { error: 404 };
  if (!req.session.guilds.some(g => g.id === t.guildId)) return { error: 403 };
  return { tournament: t };
}

// ── Full tournament data (admin-scoped; not gated on publicBracket) ──────────
router.get('/admin/api/tournaments/:id', requireSession, async (req, res) => {
  const { tournament, error } = await loadOwnedTournament(req);
  if (error) return res.status(error).json({ error: error === 404 ? 'Not found' : 'You do not manage this server' });
  res.set('Cache-Control', 'no-store');
  res.json(buildPayload(tournament));
});

// ── Bracket page wired to the admin feed (iframe target) ─────────────────────
let templateCache = null;
function bracketTemplate() {
  if (!templateCache || process.env.NODE_ENV === 'development') {
    templateCache = fs.readFileSync(path.join(__dirname, '../../public/bracket.html'), 'utf8');
  }
  return templateCache;
}

router.get('/admin/b/:id', requireSession, async (req, res) => {
  const { tournament, error } = await loadOwnedTournament(req);
  if (error) return res.status(error).send(error === 404 ? 'Not found' : 'Forbidden');

  const html = bracketTemplate()
    .replaceAll('{{TITLE}}', escapeHtml(`${tournament.title} — Bracket`))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(tournament.title))
    .replaceAll('{{BASE}}', escapeHtml(config.publicBaseUrl))
    .replaceAll('{{DATA_URL}}', `/admin/api/tournaments/${escapeHtml(req.params.id)}`)
    .replaceAll('{{TOURNAMENT_ID}}', escapeHtml(req.params.id));

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
