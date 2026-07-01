// Audit trail for web-admin actions. Every state-changing request records
// who did what where — web actions lack Discord's built-in attribution.
// Best-effort: an audit failure is logged but never blocks the action.

const db = require('../db');

async function logWebAction({ userId, username, guildId, tournamentId = null, action, details = {} }) {
  console.log(`[web-admin-audit] ${username} (${userId}) ${action} guild=${guildId}${tournamentId ? ` tournament=${tournamentId}` : ''}`, JSON.stringify(details));
  try {
    await db('web_admin_audit').insert({
      user_id: userId,
      username,
      guild_id: guildId,
      tournament_id: tournamentId,
      action,
      details: JSON.stringify(details),
    });
  } catch (err) {
    console.error('[web-admin-audit] failed to persist:', err.message);
  }
}

module.exports = { logWebAction };
