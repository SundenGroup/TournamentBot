const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEffectiveTier, capitalize } = require('../../services/subscriptionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how to use the Tournament Bot'),

  async execute(interaction) {
    const tier = getEffectiveTier(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('Tournament Bot — Help')
      .setColor(0x3498db)
      .setDescription(
        'Compete in tournaments hosted on this server. ' +
        'Sign up, check in, and track your matches — all through Discord.'
      );

    embed.addFields(
      {
        name: '🎮 Joining Tournaments',
        value: [
          '**Sign Up** — Click the "Sign Up" or "Register Team" button on tournament announcements',
          '**Withdraw** — Click "Withdraw" if you can no longer participate',
          '**Check In** — When check-in opens, click "Check In" to confirm your attendance',
        ].join('\n'),
        inline: false,
      },
      {
        name: '👥 Team Commands (`/team`)',
        value: [
          '`/team add` — Add a member to your team (captain only)',
          '`/team remove` — Remove a member from your team (captain only)',
          '`/team transfer` — Transfer captain role to another member',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📊 Match Commands (`/match`)',
        value: [
          '`/match list` — View your active matches',
          '`/match bracket` — View the tournament bracket or standings',
          '`/match games` — List pending Battle Royale games',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🏆 Tournament Formats',
        value: [
          '**Single Elimination** — Lose once, you\'re out',
          '**Double Elimination** — Lose twice to be eliminated',
          '**Swiss** — Fixed rounds, matched by record',
          '**Round Robin** — Everyone plays everyone',
          '**Battle Royale** — Multi-team lobby format',
        ].join('\n'),
        inline: false,
      },
      {
        name: '💡 Tips',
        value: [
          '• Check the tournament announcement for rules and timing',
          '• Make sure to check in before the deadline if required',
          '• Report match issues to tournament admins',
          '• Match rooms are created automatically for each round',
        ].join('\n'),
        inline: false,
      }
    );

    // Show tier info (subtle, non-promotional)
    if (tier !== 'free') {
      embed.setFooter({ text: `Server tier: ${capitalize(tier)}` });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
