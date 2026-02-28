const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTokenBalance } = require('../../data/subscriptions');
const {
  createTokenCheckout,
  createBoostCheckout,
  isStripeConfigured,
} = require('../../services/stripeService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tokens')
    .setDescription('Manage tournament tokens and participant boosts')
    .addSubcommand(sub =>
      sub
        .setName('balance')
        .setDescription('Check your token and boost balance')
    )
    .addSubcommand(sub =>
      sub
        .setName('buy-tournaments')
        .setDescription('Buy tournament tokens')
        .addStringOption(opt =>
          opt
            .setName('pack')
            .setDescription('Token pack to purchase')
            .setRequired(true)
            .addChoices(
              { name: '10 Tokens — $9.99 ($1.00 each)', value: 'tokens_10' },
              { name: '30 Tokens — $24.99 ($0.83 each)', value: 'tokens_30' },
              { name: '100 Tokens — $69.99 ($0.70 each)', value: 'tokens_100' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('buy-boost')
        .setDescription('Buy a participant boost for larger tournaments')
        .addStringOption(opt =>
          opt
            .setName('size')
            .setDescription('Boost size')
            .setRequired(true)
            .addChoices(
              { name: '+64 Participants — $4.99', value: 'boost_64' },
              { name: '+128 Participants — $9.99', value: 'boost_128' },
              { name: '+256 Participants — $19.99', value: 'boost_256' }
            )
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'balance') {
      const balance = getTokenBalance(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('🎟️ Token Balance')
        .setColor(0x5865F2)
        .addFields(
          {
            name: 'Tournament Tokens',
            value: `${balance.tournament}`,
            inline: true,
          },
          {
            name: 'Participant Boosts',
            value: balance.participantBoosts.length > 0
              ? balance.participantBoosts.map(b => `+${b.amount}`).join(', ')
              : 'None',
            inline: true,
          }
        );

      // Add expiry info if tokens exist
      if (balance.tournament > 0 && balance.tournamentExpiry) {
        const expiryTimestamp = Math.floor(new Date(balance.tournamentExpiry).getTime() / 1000);
        embed.addFields({
          name: 'Oldest Token Expires',
          value: `<t:${expiryTimestamp}:R>`,
          inline: false,
        });
      }

      // Add usage hint
      embed.setFooter({
        text: 'Tokens are used automatically when you exceed your monthly tournament limit.',
      });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'buy-tournaments') {
      if (!isStripeConfigured()) {
        return interaction.reply({
          content: '❌ Payment processing is not configured. Please contact the bot administrator.',
          ephemeral: true,
        });
      }

      const pack = interaction.options.getString('pack');

      const packDetails = {
        tokens_10: { amount: 10, price: '$9.99', perToken: '$1.00' },
        tokens_30: { amount: 30, price: '$24.99', perToken: '$0.83' },
        tokens_100: { amount: 100, price: '$69.99', perToken: '$0.70' },
      };

      const details = packDetails[pack];

      try {
        const session = await createTokenCheckout(
          interaction.guildId,
          pack,
          interaction.user.id,
          interaction.guild.name
        );

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🛒 Complete Your Purchase')
          .setDescription(`You're purchasing **${details.amount} Tournament Tokens**.`)
          .addFields(
            { name: 'Price', value: details.price, inline: true },
            { name: 'Per Token', value: details.perToken, inline: true },
            { name: 'Expires', value: '12 months after purchase', inline: true }
          )
          .setFooter({ text: 'Tokens are used automatically when you exceed your monthly limit.' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Complete Purchase')
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (error) {
        console.error('[Tokens] Error creating checkout session:', error);
        return interaction.reply({
          content: `❌ Error creating checkout: ${error.message}`,
          ephemeral: true,
        });
      }
    }

    if (subcommand === 'buy-boost') {
      if (!isStripeConfigured()) {
        return interaction.reply({
          content: '❌ Payment processing is not configured. Please contact the bot administrator.',
          ephemeral: true,
        });
      }

      const size = interaction.options.getString('size');

      const boostDetails = {
        boost_64: { amount: 64, price: '$4.99' },
        boost_128: { amount: 128, price: '$9.99' },
        boost_256: { amount: 256, price: '$19.99' },
      };

      const details = boostDetails[size];

      try {
        const session = await createBoostCheckout(
          interaction.guildId,
          size,
          interaction.user.id,
          interaction.guild.name
        );

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🛒 Complete Your Purchase')
          .setDescription(`You're purchasing a **+${details.amount} Participant Boost**.`)
          .addFields(
            { name: 'Price', value: details.price, inline: true },
            { name: 'Effect', value: `Adds ${details.amount} to max participants for one tournament`, inline: true }
          )
          .setFooter({ text: 'Boosts never expire and are applied at tournament creation.' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Complete Purchase')
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (error) {
        console.error('[Tokens] Error creating checkout session:', error);
        return interaction.reply({
          content: `❌ Error creating checkout: ${error.message}`,
          ephemeral: true,
        });
      }
    }
  },
};
