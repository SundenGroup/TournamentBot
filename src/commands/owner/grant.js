const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  grantTier,
  revokeTier,
  grantTokens,
  getActiveGrants,
  getEffectiveTier,
  capitalize,
} = require('../../services/subscriptionService');
const { getSubscription, addParticipantBoost } = require('../../data/subscriptions');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bot owner commands')
    .addSubcommand(sub =>
      sub
        .setName('grant')
        .setDescription('Grant subscription tier to a server')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('tier')
            .setDescription('Tier to grant')
            .setRequired(true)
            .addChoices(
              { name: 'Premium', value: 'premium' },
              { name: 'Pro', value: 'pro' },
              { name: 'Business', value: 'business' }
            )
        )
        .addIntegerOption(opt =>
          opt
            .setName('days')
            .setDescription('Duration in days')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(365)
        )
        .addStringOption(opt =>
          opt
            .setName('reason')
            .setDescription('Reason for grant')
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('revoke')
        .setDescription('Revoke granted tier from a server')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('grant-tokens')
        .setDescription('Grant free tournament tokens to a server')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName('amount')
            .setDescription('Number of tokens')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('grant-boost')
        .setDescription('Grant a participant boost to a server')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName('amount')
            .setDescription('Boost size')
            .setRequired(true)
            .addChoices(
              { name: '+64 participants', value: 64 },
              { name: '+128 participants', value: 128 },
              { name: '+256 participants', value: 256 }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list-grants')
        .setDescription('List all active manual grants')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check subscription status for a server')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    // Owner check
    if (!BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ BOT_OWNER_ID not configured in environment.',
        ephemeral: true,
      });
    }

    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ This command is restricted to the bot owner.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // Handle grant
    if (subcommand === 'grant') {
      const guildId = interaction.options.getString('guild_id');
      const tier = interaction.options.getString('tier');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason') || 'Manual grant';

      // Verify guild exists (optional - just log warning)
      const guild = interaction.client.guilds.cache.get(guildId);
      const guildName = guild?.name || 'Unknown Server';

      await grantTier(guildId, tier, days, reason, interaction.user.id);

      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Tier Granted')
        .addFields(
          { name: 'Server', value: `${guildName}\n\`${guildId}\``, inline: true },
          { name: 'Tier', value: capitalize(tier), inline: true },
          { name: 'Duration', value: `${days} days`, inline: true },
          { name: 'Expires', value: `<t:${expiresTimestamp}:F>\n(<t:${expiresTimestamp}:R>)`, inline: false },
          { name: 'Reason', value: reason, inline: false }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Handle revoke
    if (subcommand === 'revoke') {
      const guildId = interaction.options.getString('guild_id');

      const sub = await getSubscription(guildId);
      if (!sub || !sub.manualGrant) {
        return interaction.reply({
          content: `❌ No manual grant found for server \`${guildId}\``,
          ephemeral: true,
        });
      }

      const previousTier = sub.tier;
      await revokeTier(guildId);

      const guild = interaction.client.guilds.cache.get(guildId);
      const guildName = guild?.name || 'Unknown Server';

      return interaction.reply({
        content: `✅ Revoked **${capitalize(previousTier)}** grant from **${guildName}** (\`${guildId}\`)\nServer reverted to Free tier.`,
        ephemeral: true,
      });
    }

    // Handle grant-tokens
    if (subcommand === 'grant-tokens') {
      const guildId = interaction.options.getString('guild_id');
      const amount = interaction.options.getInteger('amount');

      await grantTokens(guildId, amount);

      const guild = interaction.client.guilds.cache.get(guildId);
      const guildName = guild?.name || 'Unknown Server';

      const sub = await getSubscription(guildId);
      const totalTokens = sub?.tokens?.tournament || amount;

      return interaction.reply({
        content: `✅ Granted **${amount} tournament tokens** to **${guildName}** (\`${guildId}\`)\nTotal balance: **${totalTokens}** tokens`,
        ephemeral: true,
      });
    }

    // Handle grant-boost
    if (subcommand === 'grant-boost') {
      const guildId = interaction.options.getString('guild_id');
      const amount = interaction.options.getInteger('amount');

      await addParticipantBoost(guildId, amount);

      const guild = interaction.client.guilds.cache.get(guildId);
      const guildName = guild?.name || 'Unknown Server';

      const sub = await getSubscription(guildId);
      const boosts = sub?.tokens?.participantBoosts?.filter(b => !b.used) || [];

      return interaction.reply({
        content: `✅ Granted **+${amount} participant boost** to **${guildName}** (\`${guildId}\`)\nAvailable boosts: ${boosts.map(b => `+${b.amount}`).join(', ') || 'None'}`,
        ephemeral: true,
      });
    }

    // Handle list-grants
    if (subcommand === 'list-grants') {
      const grants = await getActiveGrants();

      if (grants.length === 0) {
        return interaction.reply({
          content: '📋 No active manual grants.',
          ephemeral: true,
        });
      }

      const lines = grants.map(sub => {
        const guild = interaction.client.guilds.cache.get(sub.guildId);
        const guildName = guild?.name || 'Unknown';
        const expiresAt = Math.floor(new Date(sub.manualGrant.expiresAt).getTime() / 1000);
        return `• **${guildName}** (\`${sub.guildId}\`)\n  ${capitalize(sub.tier)} — expires <t:${expiresAt}:R> — ${sub.manualGrant.reason}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📋 Active Grants (${grants.length})`)
        .setDescription(lines.join('\n\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Handle status
    if (subcommand === 'status') {
      const guildId = interaction.options.getString('guild_id');

      const guild = interaction.client.guilds.cache.get(guildId);
      const guildName = guild?.name || 'Unknown Server';

      const sub = await getSubscription(guildId);
      const tier = await getEffectiveTier(guildId);

      if (!sub) {
        return interaction.reply({
          content: `📊 **${guildName}** (\`${guildId}\`)\nTier: **Free** (no subscription record)`,
          ephemeral: true,
        });
      }

      const fields = [
        `**Tier:** ${capitalize(tier)}`,
        `**Tournaments this month:** ${sub.usage?.tournamentsThisMonth || 0}`,
        `**Concurrent active:** ${sub.usage?.concurrentActive || 0}`,
        `**Tournament tokens:** ${sub.tokens?.tournament || 0}`,
        `**Participant boosts:** ${sub.tokens?.participantBoosts?.filter(b => !b.used).map(b => `+${b.amount}`).join(', ') || 'None'}`,
      ];

      if (sub.manualGrant) {
        const expiresAt = Math.floor(new Date(sub.manualGrant.expiresAt).getTime() / 1000);
        fields.push(`**Grant expires:** <t:${expiresAt}:R>`);
        fields.push(`**Grant reason:** ${sub.manualGrant.reason}`);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 ${guildName}`)
        .setDescription(fields.join('\n'))
        .setFooter({ text: guildId });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
