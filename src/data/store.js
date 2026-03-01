// Data store - backed by PostgreSQL via Knex
// These Maps are kept as in-memory caches for backward compatibility
// but the source of truth is now the database.

const db = require('../db');

// In-memory caches (populated on startup, kept in sync)
const tournaments = new Map();
const serverSettings = new Map();

/**
 * Load all active tournaments from database into memory cache
 */
async function loadTournaments() {
  const rows = await db('tournaments').select('*');
  tournaments.clear();
  for (const row of rows) {
    tournaments.set(row.id, rowToTournament(row));
  }
  console.log(`[Store] Loaded ${rows.length} tournament(s) from database`);
}

/**
 * Load all server settings from database into memory cache
 */
async function loadServerSettings() {
  const rows = await db('server_settings').select('*');
  serverSettings.clear();
  for (const row of rows) {
    serverSettings.set(row.guild_id, rowToServerSettings(row));
  }
  console.log(`[Store] Loaded ${rows.length} server setting(s) from database`);
}

// ============================================================================
// Row converters (snake_case DB → camelCase JS)
// ============================================================================

function rowToTournament(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    participantListMessageId: row.participant_list_message_id,
    title: row.title,
    description: row.description,
    game: row.game || {},
    settings: row.settings || {},
    setupMode: row.setup_mode,
    startTime: row.start_time,
    status: row.status,
    checkinOpen: row.checkin_open,
    participants: row.participants || [],
    teams: row.teams || [],
    bracket: row.bracket || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToServerSettings(row) {
  return {
    announcementChannelName: row.announcement_channel_name,
    announcementChannelId: row.announcement_channel_id,
    matchRoomCategory: row.match_room_category,
    defaultFormat: row.default_format,
    defaultCheckin: row.default_checkin,
    defaultCheckinWindow: row.default_checkin_window,
    autoCleanup: row.auto_cleanup,
    autoCleanupMode: row.auto_cleanup_mode,
    tournamentAdminRoles: row.tournament_admin_roles || [],
    captainMode: row.captain_mode,
  };
}

module.exports = {
  tournaments,
  serverSettings,
  loadTournaments,
  loadServerSettings,
  rowToTournament,
  rowToServerSettings,
};
