// Server-specific settings
// Will be replaced with database in future

const serverSettings = new Map();

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

function getServerSettings(guildId) {
  if (!serverSettings.has(guildId)) {
    serverSettings.set(guildId, { ...DEFAULT_SETTINGS });
  }
  return serverSettings.get(guildId);
}

function updateServerSettings(guildId, updates) {
  const current = getServerSettings(guildId);
  const updated = { ...current, ...updates };
  serverSettings.set(guildId, updated);
  return updated;
}

function setAnnouncementChannel(guildId, channelId, channelName) {
  return updateServerSettings(guildId, {
    announcementChannelId: channelId,
    announcementChannelName: channelName,
  });
}

function getAnnouncementChannelId(guildId) {
  return getServerSettings(guildId).announcementChannelId;
}

function getAnnouncementChannelName(guildId) {
  return getServerSettings(guildId).announcementChannelName;
}

function getTournamentAdminRoles(guildId) {
  return getServerSettings(guildId).tournamentAdminRoles || [];
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
