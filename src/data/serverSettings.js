// Server-specific settings — backed by PostgreSQL

const db = require('../db');
const { serverSettings } = require('./store');

const DEFAULT_SETTINGS = {
  announcementChannelName: 'tournament-announcements',
  announcementChannelId: null,
  matchRoomCategory: null,
  defaultFormat: 'single_elimination',
  defaultCheckin: false,
  defaultCheckinWindow: 30,
  autoCleanup: false,
  autoCleanupMode: 'delete',
  tournamentAdminRoles: [],
  captainMode: false,
};

// ============================================================================
// Helpers
// ============================================================================

function settingsToRow(guildId, settings) {
  return {
    guild_id: guildId,
    announcement_channel_name: settings.announcementChannelName,
    announcement_channel_id: settings.announcementChannelId,
    match_room_category: settings.matchRoomCategory,
    default_format: settings.defaultFormat,
    default_checkin: settings.defaultCheckin,
    default_checkin_window: settings.defaultCheckinWindow,
    auto_cleanup: settings.autoCleanup,
    auto_cleanup_mode: settings.autoCleanupMode,
    tournament_admin_roles: JSON.stringify(settings.tournamentAdminRoles || []),
    captain_mode: settings.captainMode,
  };
}

function rowToSettings(row) {
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

// ============================================================================
// Public API (all async)
// ============================================================================

async function getServerSettings(guildId) {
  // Check memory cache first
  if (serverSettings.has(guildId)) {
    return serverSettings.get(guildId);
  }

  // Check database
  const row = await db('server_settings').where('guild_id', guildId).first();
  if (row) {
    const settings = rowToSettings(row);
    serverSettings.set(guildId, settings);
    return settings;
  }

  // Return defaults (don't persist until explicitly updated)
  const defaults = { ...DEFAULT_SETTINGS };
  serverSettings.set(guildId, defaults);
  return defaults;
}

async function updateServerSettings(guildId, updates) {
  const current = await getServerSettings(guildId);
  const updated = { ...current, ...updates };

  // Upsert into database
  const row = settingsToRow(guildId, updated);
  await db('server_settings')
    .insert(row)
    .onConflict('guild_id')
    .merge({ ...row, updated_at: db.fn.now() });

  // Update memory cache
  serverSettings.set(guildId, updated);
  return updated;
}

async function setAnnouncementChannel(guildId, channelId, channelName) {
  return updateServerSettings(guildId, {
    announcementChannelId: channelId,
    announcementChannelName: channelName,
  });
}

async function getAnnouncementChannelId(guildId) {
  const settings = await getServerSettings(guildId);
  return settings.announcementChannelId;
}

async function getAnnouncementChannelName(guildId) {
  const settings = await getServerSettings(guildId);
  return settings.announcementChannelName;
}

async function getTournamentAdminRoles(guildId) {
  const settings = await getServerSettings(guildId);
  return settings.tournamentAdminRoles || [];
}

module.exports = {
  serverSettings,
  getServerSettings,
  updateServerSettings,
  setAnnouncementChannel,
  getAnnouncementChannelId,
  getAnnouncementChannelName,
  getTournamentAdminRoles,
  DEFAULT_SETTINGS,
};
