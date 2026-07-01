// Web-admin: Discord OAuth2 login + authorization.
//
//   GET /admin/login    → redirect to Discord's consent screen
//   GET /admin/callback → exchange code, compute manageable guilds, set session
//   GET /admin/logout   → clear session
//
// A user can "manage" a guild if the bot is in it AND the user has
// Administrator / Manage Server there, is the owner, or holds a configured
// tournament-admin role — mirroring canManageTournaments() in Discord.

const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { getClient } = require('./botClient');
const { getServerSettings } = require('../data/serverSettings');
const session = require('./session');

const router = express.Router();

const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_GUILD = 1n << 5n;

const DISCORD_API = 'https://discord.com/api/v10';

function guildIconUrl(g) {
  return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
}

/**
 * Given the OAuth user id + their guild list, return the guilds they can manage
 * (bot present + admin rights). Bounded by the bot's guild count.
 */
async function computeManageableGuilds(userId, userGuilds) {
  const client = getClient();
  const botGuildIds = new Set(client ? client.guilds.cache.map(g => g.id) : []);
  const manageable = [];

  for (const ug of userGuilds) {
    if (!botGuildIds.has(ug.id)) continue;

    let canManage = false;
    try {
      const perms = BigInt(ug.permissions || '0');
      if (ug.owner || (perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR || (perms & PERM_MANAGE_GUILD) === PERM_MANAGE_GUILD) {
        canManage = true;
      }
    } catch { /* ignore bad perms */ }

    // Role-based fallback: tournament-admin roles configured for this guild
    if (!canManage) {
      try {
        const settings = await getServerSettings(ug.id);
        const adminRoles = settings.tournamentAdminRoles || [];
        if (adminRoles.length) {
          const guild = client.guilds.cache.get(ug.id);
          const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
          if (member && adminRoles.some(r => member.roles.cache.has(r))) canManage = true;
        }
      } catch { /* ignore */ }
    }

    if (canManage) manageable.push({ id: ug.id, name: ug.name, icon: guildIconUrl(ug) });
  }
  return manageable;
}

router.get('/admin/login', (req, res) => {
  if (!config.webAdmin.enabled) {
    return res.status(503).send('Web admin is not configured (missing DISCORD_CLIENT_SECRET).');
  }
  const state = crypto.randomBytes(16).toString('hex');
  session.setOAuthState(res, state);
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.webAdmin.oauthRedirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/admin/callback', async (req, res) => {
  if (!config.webAdmin.enabled) return res.status(503).send('Web admin is not configured.');

  const { code, state } = req.query;
  const expectedState = session.takeOAuthState(req, res);
  if (!code || !state || state !== expectedState) {
    return res.status(400).send('Login failed (invalid state). <a href="/admin">Try again</a>.');
  }

  try {
    // Exchange the code for a user access token
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: config.webAdmin.oauthRedirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
    const token = await tokenRes.json();
    const authHeader = { Authorization: `Bearer ${token.access_token}` };

    const [user, guilds] = await Promise.all([
      fetch(`${DISCORD_API}/users/@me`, { headers: authHeader }).then(r => r.json()),
      fetch(`${DISCORD_API}/users/@me/guilds`, { headers: authHeader }).then(r => r.json()),
    ]);
    if (!user?.id || !Array.isArray(guilds)) throw new Error('failed to load Discord profile');

    const manageable = await computeManageableGuilds(user.id, guilds);

    session.setSession(res, {
      uid: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
      guilds: manageable,
    });
    res.redirect('/admin');
  } catch (err) {
    console.error('[web-admin] OAuth callback error:', err.message);
    res.status(500).send('Login failed. <a href="/admin">Try again</a>.');
  }
});

router.get('/admin/logout', (req, res) => {
  session.clearSession(res);
  res.redirect('/admin');
});

// ── Middleware ──────────────────────────────────────────────────────────────

/** Require a valid session; returns 401 JSON for API routes. */
function requireSession(req, res, next) {
  const s = session.getSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in' });
  req.session = s;
  next();
}

/** Require that req.session can manage the guild in req.params.guildId. */
function requireGuildAdmin(req, res, next) {
  const guildId = req.params.guildId;
  if (!req.session.guilds.some(g => g.id === guildId)) {
    return res.status(403).json({ error: 'You do not manage this server' });
  }
  next();
}

module.exports = { router, requireSession, requireGuildAdmin, computeManageableGuilds };
