// Wizard session storage — backed by PostgreSQL

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

async function createSession(userId, guildId) {
  const id = uuidv4();
  const session = {
    id,
    userId,
    guildId,
    data: {},
    createdAt: Date.now(),
  };

  await db('wizard_sessions').insert({
    id,
    user_id: userId,
    guild_id: guildId,
    data: JSON.stringify({}),
  });

  return session;
}

async function getSession(id) {
  const row = await db('wizard_sessions').where('id', id).first();
  if (!row) return null;

  const createdAt = new Date(row.created_at).getTime();

  // Check if expired
  if (Date.now() - createdAt > SESSION_TTL) {
    await db('wizard_sessions').where('id', id).del();
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id,
    data: row.data || {},
    createdAt,
  };
}

async function updateSession(id, dataObj) {
  const session = await getSession(id);
  if (!session) return null;

  const merged = { ...session.data, ...dataObj };
  await db('wizard_sessions')
    .where('id', id)
    .update({ data: JSON.stringify(merged) });

  session.data = merged;
  return session;
}

async function deleteSession(id) {
  const deleted = await db('wizard_sessions').where('id', id).del();
  return deleted > 0;
}

/**
 * Clean up expired sessions (called by cron)
 */
async function cleanupExpiredSessions() {
  const cutoff = new Date(Date.now() - SESSION_TTL);
  const deleted = await db('wizard_sessions')
    .where('created_at', '<', cutoff)
    .del();
  return deleted;
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  cleanupExpiredSessions,
};
