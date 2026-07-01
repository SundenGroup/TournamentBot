// Simple-mode creation modal submit. The shared creation orchestration
// (subscription checks, channel resolution, announcement, reminders, usage
// accounting) lives in services/creationService.js — also used by the
// advanced wizard and the web-admin dashboard.

const { GAME_PRESETS } = require('../config/gamePresets');
const { parseDateTime } = require('../utils/timeUtils');
const { runCreationChecks, resolveAnnouncementChannel, createAndAnnounce } = require('../services/creationService');
const {
  checkFeature,
  getEffectiveTier,
  getUpgradeEmbed,
  getTokenPurchaseEmbed,
  getBoostPurchaseEmbed,
} = require('../services/subscriptionService');

/** Render a failed creation check as the right upgrade/purchase prompt. */
async function checkFailureReply(guildId, checks) {
  if (checks.type === 'tournament_limit') return getTokenPurchaseEmbed(checks.check);
  if (checks.type === 'participants') return getBoostPurchaseEmbed(checks.check);
  if (checks.type === 'feature') return getUpgradeEmbed(checks.feature, checks.tier ?? await getEffectiveTier(guildId));
  return getUpgradeEmbed('concurrent', checks.tier ?? await getEffectiveTier(guildId), checks.check?.reason);
}

module.exports = {
  customId: 'simpleCreate',
  checkFailureReply, // shared with wizardCreate.js
  async execute(interaction, args) {
    const gamePreset = args[0];
    // Optional per-tournament announcement channel (threaded through the
    // customId chain from /tournament create channel:#…)
    const overrideChannelId = args[1] || null;
    const preset = GAME_PRESETS[gamePreset];
    const guildId = interaction.guildId;

    const title = interaction.fields.getTextInputValue('title');
    const datetimeStr = interaction.fields.getTextInputValue('datetime');
    const maxParticipantsStr = interaction.fields.getTextInputValue('maxParticipants');

    let gameName = preset?.displayName;
    if (gamePreset === 'custom') {
      gameName = interaction.fields.getTextInputValue('gameName');
    }

    const startTime = parseDateTime(datetimeStr);
    if (!startTime) {
      return interaction.reply({
        content: '❌ Could not parse the date/time. Please use a format like "Feb 15 7pm UTC".',
        ephemeral: true,
      });
    }

    const maxParticipants = parseInt(maxParticipantsStr, 10);
    if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 128) {
      return interaction.reply({
        content: '❌ Max participants must be a number between 2 and 128.',
        ephemeral: true,
      });
    }

    // Subscription checks (concurrent / monthly / participant cap + boosts)
    const checks = await runCreationChecks(guildId, { maxParticipants });
    if (!checks.ok) {
      return interaction.reply({ ...(await checkFailureReply(guildId, checks)) });
    }

    // Live web bracket (Pro/Business): enabled automatically in simple mode
    // when the tier allows it — advanced mode exposes an explicit toggle.
    const publicBracket = (await checkFeature(guildId, 'public_bracket')).allowed;

    // Announcement channel: per-tournament override → per-game → server default
    const resolved = await resolveAnnouncementChannel(interaction.guild, gamePreset, overrideChannelId);
    if (resolved.error) {
      return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
    }
    const targetChannel = resolved.channel || interaction.channel;

    // Ack inside the 3s modal window; the announcement posts right after.
    await interaction.reply({
      content: `✅ Tournament created! Announced in ${targetChannel}.`,
      ephemeral: true,
    });

    await createAndAnnounce({
      client: interaction.client,
      guildId,
      targetChannel,
      boostToUse: checks.boostToUse,
      data: {
        title,
        gamePreset,
        gameDisplayName: gameName,
        gameShortName: gamePreset === 'custom' ? gameName.substring(0, 4).toUpperCase() : preset?.shortName,
        maxParticipants,
        startTime,
        publicBracket,
        setupMode: 'simple',
        createdBy: interaction.user.id,
      },
    });
  },
};
