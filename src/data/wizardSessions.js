const { v4: uuidv4 } = require('uuid');

// In-memory wizard session storage
// Map<sessionId, { id, userId, guildId, data: {...}, createdAt }>
const sessions = new Map();

const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function createSession(userId, guildId) {
  const id = uuidv4();
  const session = {
    id,
    userId,
    guildId,
    data: {},
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;

  // Check if expired
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(id);
    return null;
  }

  return session;
}

function updateSession(id, dataObj) {
  const session = sessions.get(id);
  if (!session) return null;

  Object.assign(session.data, dataObj);
  return session;
}

function deleteSession(id) {
  return sessions.delete(id);
}

// Auto-cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
};
