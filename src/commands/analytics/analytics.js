const { SlashCommandBuilder } = require('discord.js');
const { checkFeature, getEffectiveTier, getUpgradeEmbed } = require('../../services/subscriptionService');
const { getAnalyticsEmbed } = require('../../services/analyticsService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('View tournament analytics for this server (Pro feature)'),

  async execute(interaction) {
    // Pro feature gate
    const featureCheck = checkFeature(interaction.guildId, 'advanced_analytics');
    if (!featureCheck.allowed) {
      return interaction.reply(getUpgradeEmbed('advanced_analytics', getEffectiveTier(interaction.guildId)));
    }

    const embed = getAnalyticsEmbed(interaction.guildId, interaction.guild.name);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
