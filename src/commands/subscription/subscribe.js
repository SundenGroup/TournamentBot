const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getStatusEmbed, getEffectiveTier, capitalize, TIER_LIMITS, startFreeTrial, isInGracePeriod, GRACE_PERIOD_DAYS } = require('../../services/subscriptionService');
const {
  createSubscriptionCheckout,
  createBillingPortalSession,
  isStripeConfigured,
} = require('../../services/stripeService');
const { getSubscription, updateSubscription, getBranding, updateBranding, clearBranding } = require('../../data/subscriptions');
const { generateApiKey, generateWebhookSecret, hashApiKey } = require('../../utils/apiKeyGenerator');
const { testWebhook, WEBHOOK_EVENTS } = require('../../services/webhookService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Manage your server subscription')
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('View your current subscription status, usage, and limits')
    )
    .addSubcommand(sub =>
      sub
        .setName('upgrade')
        .setDescription('Upgrade your subscription tier')
        .addStringOption(opt =>
          opt
            .setName('tier')
            .setDescription('Tier to upgrade to')
            .setRequired(true)
            .addChoices(
              { name: 'Premium — $5.99/mo or $49/yr', value: 'premium' },
              { name: 'Pro — $24.99/mo or $199/yr', value: 'pro' },
              { name: 'Business — $99/mo or $899/yr', value: 'business' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('billing')
            .setDescription('Billing cycle')
            .setRequired(true)
            .addChoices(
              { name: 'Monthly', value: 'monthly' },
              { name: 'Annual (save up to 34%)', value: 'annual' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('manage')
        .setDescription('Manage your subscription (billing, cancel, update payment)')
    )
    .addSubcommand(sub =>
      sub
        .setName('plans')
        .setDescription('View available subscription plans and features')
    )
    .addSubcommand(sub =>
      sub
        .setName('api-key')
        .setDescription('Manage your REST API key (Business tier)')
        .addStringOption(opt =>
          opt
            .setName('action')
            .setDescription('Action to perform')
            .setRequired(true)
            .addChoices(
              { name: 'Generate — Create a new API key', value: 'generate' },
              { name: 'View — Show current API key status', value: 'view' },
              { name: 'Regenerate — Create new key (invalidates old)', value: 'regenerate' },
              { name: 'Revoke — Disable API access', value: 'revoke' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('webhook')
        .setDescription('Configure webhook notifications (Business tier)')
        .addStringOption(opt =>
          opt
            .setName('action')
            .setDescription('Action to perform')
            .setRequired(true)
            .addChoices(
              { name: 'Configure — Set webhook URL', value: 'configure' },
              { name: 'View — Show webhook settings', value: 'view' },
              { name: 'Test — Send test webhook', value: 'test' },
              { name: 'Disable — Turn off webhooks', value: 'disable' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('Webhook URL (required for configure action)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('trial')
        .setDescription('Start a free 7-day Premium trial')
    )
    .addSubcommand(sub =>
      sub
        .setName('branding')
        .setDescription('Configure white-label branding (Business tier)')
        .addStringOption(opt =>
          opt
            .setName('action')
            .setDescription('Action to perform')
            .setRequired(true)
            .addChoices(
              { name: 'View — Show current branding', value: 'view' },
              { name: 'Set Name — Custom bot name', value: 'set-name' },
              { name: 'Set Avatar — Custom avatar URL', value: 'set-avatar' },
              { name: 'Set Color — Custom accent color', value: 'set-color' },
              { name: 'Set Footer — Custom footer text', value: 'set-footer' },
              { name: 'Reset — Clear all branding', value: 'reset' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('value')
            .setDescription('Value for the setting (name, URL, hex color, or footer text)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      return await this.handleSubcommand(interaction, subcommand);
    } catch (error) {
      console.error(`[Subscribe] Error in ${subcommand}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: `❌ An error occurred: ${error.message}`,
          ephemeral: true,
        });
      } else {
        return interaction.editReply({
          content: `❌ An error occurred: ${error.message}`,
        });
      }
    }
  },

  async handleSubcommand(interaction, subcommand) {
    if (subcommand === 'status') {
      const embed = await getStatusEmbed(interaction.guildId);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'upgrade') {
      if (!isStripeConfigured()) {
        return interaction.reply({
          content: '❌ Payment processing is not configured. Please contact the bot administrator.',
          ephemeral: true,
        });
      }

      const tier = interaction.options.getString('tier');
      const billingCycle = interaction.options.getString('billing');
      const currentTier = await getEffectiveTier(interaction.guildId);

      // Check if already at or above this tier
      const tierOrder = ['free', 'premium', 'pro', 'business'];
      if (tierOrder.indexOf(currentTier) >= tierOrder.indexOf(tier)) {
        return interaction.reply({
          content: `❌ You already have ${capitalize(currentTier)} tier. Use \`/subscribe manage\` to change your plan.`,
          ephemeral: true,
        });
      }

      try {
        const session = await createSubscriptionCheckout(
          interaction.guildId,
          tier,
          billingCycle,
          interaction.user.id,
          interaction.guild.name
        );

        const priceDisplay = {
          premium_monthly: '$5.99/month',
          premium_annual: '$49/year (save 32%)',
          pro_monthly: '$24.99/month',
          pro_annual: '$199/year (save 34%)',
          business_monthly: '$99/month',
          business_annual: '$899/year (save 24%)',
        };

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🛒 Complete Your Subscription')
          .setDescription(`You're upgrading to **${capitalize(tier)}** tier.`)
          .addFields(
            { name: 'Price', value: priceDisplay[`${tier}_${billingCycle}`], inline: true },
            { name: 'Billing', value: capitalize(billingCycle), inline: true }
          )
          .setFooter({ text: 'You will be redirected to Stripe to complete payment securely.' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Complete Purchase')
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (error) {
        console.error('[Subscribe] Error creating checkout session:', error);
        return interaction.reply({
          content: `❌ Error creating checkout: ${error.message}`,
          ephemeral: true,
        });
      }
    }

    if (subcommand === 'manage') {
      const sub = await getSubscription(interaction.guildId);

      if (!sub?.stripeCustomerId) {
        return interaction.reply({
          content: '❌ No active paid subscription found. Use `/subscribe upgrade` to subscribe.',
          ephemeral: true,
        });
      }

      if (!isStripeConfigured()) {
        return interaction.reply({
          content: '❌ Payment processing is not configured. Please contact the bot administrator.',
          ephemeral: true,
        });
      }

      try {
        const session = await createBillingPortalSession(interaction.guildId);

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('⚙️ Manage Subscription')
          .setDescription('Click below to manage your subscription, update payment method, or cancel.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Open Billing Portal')
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (error) {
        console.error('[Subscribe] Error creating portal session:', error);
        return interaction.reply({
          content: `❌ Error opening billing portal: ${error.message}`,
          ephemeral: true,
        });
      }
    }

    if (subcommand === 'plans') {
      const currentTier = await getEffectiveTier(interaction.guildId);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 Subscription Plans')
        .setDescription(`Your current tier: **${capitalize(currentTier)}**`)
        .addFields(
          {
            name: '🆓 Free',
            value: [
              '• 3 tournaments/month',
              '• 50 max participants',
              '• 1 concurrent tournament',
              '• Basic features',
            ].join('\n'),
            inline: true,
          },
          {
            name: '⭐ Premium — $5.99/mo',
            value: [
              '• 15 tournaments/month',
              '• 128 max participants',
              '• 3 concurrent tournaments',
              '• Check-in, seeding, captain mode',
              '• Auto-cleanup, required roles',
            ].join('\n'),
            inline: true,
          },
          {
            name: '\u200B',
            value: '\u200B',
            inline: true,
          },
          {
            name: '💎 Pro — $24.99/mo',
            value: [
              '• 50 tournaments/month',
              '• 256 max participants',
              '• 10 concurrent tournaments',
              '• All Premium features',
              '• Tournament templates',
              '• Advanced analytics',
            ].join('\n'),
            inline: true,
          },
          {
            name: '🏢 Business — $99/mo',
            value: [
              '• 200 tournaments/month',
              '• 512 max participants',
              '• Unlimited concurrent',
              '• All Pro features',
              '• Results API & webhooks',
              '• White-label branding',
              '• 5 servers per subscription',
            ].join('\n'),
            inline: true,
          },
          {
            name: '\u200B',
            value: '\u200B',
            inline: true,
          }
        )
        .setFooter({ text: 'Annual billing saves up to 34%. Use /subscribe upgrade to get started.' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================================
    // API Key Management (Business tier)
    // ============================================================================

    if (subcommand === 'api-key') {
      // Check Business tier
      const tier = await getEffectiveTier(interaction.guildId);
      if (tier !== 'business') {
        return interaction.reply({
          content: '❌ API access requires Business tier. Use `/subscribe upgrade` to upgrade.',
          ephemeral: true,
        });
      }

      // Check admin permissions
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Only server administrators can manage API keys.',
          ephemeral: true,
        });
      }

      const action = interaction.options.getString('action');
      const sub = await getSubscription(interaction.guildId);

      if (action === 'generate') {
        if (sub?.apiKeyHash) {
          return interaction.reply({
            content: '❌ An API key already exists. Use `regenerate` to create a new one or `revoke` to disable it.',
            ephemeral: true,
          });
        }

        const apiKey = generateApiKey();
        const keyHash = hashApiKey(apiKey);

        // Persist only the hash — the plaintext key is shown once below and never
        // stored at rest.
        await updateSubscription(interaction.guildId, {
          apiKeyHash: keyHash,
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🔑 API Key Generated')
          .setDescription('Your API key has been created. **Save it now — it will only be shown once!**')
          .addFields(
            { name: 'API Key', value: `\`${apiKey}\``, inline: false },
            { name: 'Usage', value: 'Include in requests as: `Authorization: Bearer <key>`', inline: false },
            { name: 'Base URL', value: `\`${process.env.API_BASE_URL || 'http://localhost:3000'}/v1\``, inline: false }
          )
          .setFooter({ text: 'Keep this key secret. Anyone with it can access your tournament data.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'view') {
        if (!sub?.apiKeyHash) {
          return interaction.reply({
            content: '❌ No API key configured. Use `/subscribe api-key action:generate` to create one.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔑 API Key Status')
          .setDescription('An API key is configured for this server.')
          .addFields(
            { name: 'Status', value: '✅ Active', inline: true },
            { name: 'Key Prefix', value: '`tb_live_****`', inline: true },
            { name: 'Base URL', value: `\`${process.env.API_BASE_URL || 'http://localhost:3000'}/v1\``, inline: false },
            { name: 'Endpoints', value: [
              '`GET /v1/tournaments` — List tournaments',
              '`GET /v1/tournaments/:id` — Get tournament details',
              '`GET /v1/tournaments/:id/bracket` — Get bracket',
              '`GET /v1/tournaments/:id/matches` — Get matches',
              '`GET /v1/tournaments/:id/participants` — Get participants',
              '`GET /v1/tournaments/:id/standings` — Get standings',
            ].join('\n'), inline: false }
          )
          .setFooter({ text: 'Rate limit: 120 requests per minute' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'regenerate') {
        const apiKey = generateApiKey();
        const keyHash = hashApiKey(apiKey);

        // Persist only the hash (see generate above).
        await updateSubscription(interaction.guildId, {
          apiKeyHash: keyHash,
        });

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('🔄 API Key Regenerated')
          .setDescription('A new API key has been created. **The old key is now invalid.**')
          .addFields(
            { name: 'New API Key', value: `\`${apiKey}\``, inline: false },
            { name: 'Usage', value: 'Include in requests as: `Authorization: Bearer <key>`', inline: false }
          )
          .setFooter({ text: 'Update your integrations with this new key immediately.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'revoke') {
        if (!sub?.apiKeyHash) {
          return interaction.reply({
            content: '❌ No API key to revoke.',
            ephemeral: true,
          });
        }

        await updateSubscription(interaction.guildId, {
          apiKey: null,
          apiKeyHash: null,
        });

        return interaction.reply({
          content: '✅ API key revoked. All API access has been disabled.',
          ephemeral: true,
        });
      }
    }

    // ============================================================================
    // Webhook Configuration (Business tier)
    // ============================================================================

    if (subcommand === 'webhook') {
      // Check Business tier
      const tier = await getEffectiveTier(interaction.guildId);
      if (tier !== 'business') {
        return interaction.reply({
          content: '❌ Webhooks require Business tier. Use `/subscribe upgrade` to upgrade.',
          ephemeral: true,
        });
      }

      // Check admin permissions
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Only server administrators can manage webhooks.',
          ephemeral: true,
        });
      }

      const action = interaction.options.getString('action');
      const sub = await getSubscription(interaction.guildId);

      if (action === 'configure') {
        const url = interaction.options.getString('url');

        if (!url) {
          return interaction.reply({
            content: '❌ Please provide a webhook URL: `/subscribe webhook action:configure url:https://your-server.com/webhook`',
            ephemeral: true,
          });
        }

        // Validate URL format
        try {
          new URL(url);
        } catch {
          return interaction.reply({
            content: '❌ Invalid URL format. Please provide a valid HTTPS URL.',
            ephemeral: true,
          });
        }

        if (!url.startsWith('https://')) {
          return interaction.reply({
            content: '❌ Webhook URL must use HTTPS for security.',
            ephemeral: true,
          });
        }

        // Generate webhook secret
        const webhookSecret = generateWebhookSecret();

        await updateSubscription(interaction.guildId, {
          webhookUrl: url,
          webhookSecret: webhookSecret,
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🔔 Webhook Configured')
          .setDescription('Webhook notifications are now enabled.')
          .addFields(
            { name: 'URL', value: `\`${url}\``, inline: false },
            { name: 'Secret', value: `\`${webhookSecret}\``, inline: false },
            { name: 'Signature Header', value: '`X-Webhook-Signature`', inline: true },
            { name: 'Event Header', value: '`X-Webhook-Event`', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Events', value: [
              '• `tournament.created` — Tournament created',
              '• `tournament.started` — Tournament started',
              '• `tournament.completed` — Tournament finished',
              '• `tournament.cancelled` — Tournament cancelled',
              '• `participant.registered` — Player/team joined',
              '• `participant.withdrawn` — Player/team left',
              '• `participant.checked_in` — Player/team checked in',
              '• `match.started` — Match began',
              '• `match.completed` — Match finished',
            ].join('\n'), inline: false }
          )
          .setFooter({ text: 'Save the secret to verify webhook signatures. Use /subscribe webhook action:test to test.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'view') {
        if (!sub?.webhookUrl) {
          return interaction.reply({
            content: '❌ No webhook configured. Use `/subscribe webhook action:configure url:...` to set one up.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔔 Webhook Settings')
          .addFields(
            { name: 'Status', value: '✅ Active', inline: true },
            { name: 'URL', value: `\`${sub.webhookUrl}\``, inline: false },
            { name: 'Secret', value: sub.webhookSecret ? '`whsec_****` (configured)' : 'Not set', inline: true }
          )
          .setFooter({ text: 'Use action:test to send a test webhook, action:disable to turn off.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'test') {
        if (!sub?.webhookUrl || !sub?.webhookSecret) {
          return interaction.reply({
            content: '❌ Webhook not configured. Use `/subscribe webhook action:configure url:...` first.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const result = await testWebhook(interaction.guildId);

        if (result.success) {
          return interaction.editReply({
            content: `✅ Test webhook sent successfully! (HTTP ${result.status})`,
          });
        } else {
          return interaction.editReply({
            content: `❌ Test webhook failed: ${result.error}`,
          });
        }
      }

      if (action === 'disable') {
        if (!sub?.webhookUrl) {
          return interaction.reply({
            content: '❌ No webhook configured to disable.',
            ephemeral: true,
          });
        }

        await updateSubscription(interaction.guildId, {
          webhookUrl: null,
          webhookSecret: null,
        });

        return interaction.reply({
          content: '✅ Webhooks disabled. You will no longer receive webhook notifications.',
          ephemeral: true,
        });
      }
    }

    // ============================================================================
    // Free Trial
    // ============================================================================

    if (subcommand === 'trial') {
      const result = await startFreeTrial(interaction.guildId, interaction.user.id);

      if (!result.success) {
        return interaction.reply({
          content: `❌ ${result.reason}`,
          ephemeral: true,
        });
      }

      const expiryTimestamp = Math.floor(result.expiresAt.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎉 Free Trial Activated!')
        .setDescription('You now have **Premium** features for 7 days!')
        .addFields(
          {
            name: 'Trial Features',
            value: [
              '• Check-in system',
              '• Seeding',
              '• Captain Mode',
              '• Auto-cleanup',
              '• Required roles',
              '• Full reminders (24h + 1h)',
              '• 15 tournaments/month',
              '• 128 max participants',
              '• 3 concurrent tournaments',
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Expires',
            value: `<t:${expiryTimestamp}:R>`,
            inline: true,
          }
        )
        .setFooter({ text: 'Use /subscribe upgrade to continue after your trial ends.' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================================
    // White-Label Branding (Business tier)
    // ============================================================================

    if (subcommand === 'branding') {
      // Check Business tier
      const tier = await getEffectiveTier(interaction.guildId);
      if (tier !== 'business') {
        return interaction.reply({
          content: '❌ White-label branding requires Business tier. Use `/subscribe upgrade` to upgrade.',
          ephemeral: true,
        });
      }

      // Check admin permissions
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Only server administrators can manage branding.',
          ephemeral: true,
        });
      }

      const action = interaction.options.getString('action');
      const value = interaction.options.getString('value');

      if (action === 'view') {
        const branding = await getBranding(interaction.guildId);

        if (!branding || (!branding.botName && !branding.botAvatar && !branding.accentColor && !branding.footerText)) {
          return interaction.reply({
            content: '❌ No branding configured. Use `/subscribe branding action:set-name value:...` to get started.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(branding.accentColor ? parseInt(branding.accentColor.replace('#', ''), 16) : 0x5865F2)
          .setTitle('🎨 White-Label Branding')
          .setDescription('Your custom branding settings:')
          .addFields(
            { name: 'Bot Name', value: branding.botName || '*Not set*', inline: true },
            { name: 'Accent Color', value: branding.accentColor || '*Not set*', inline: true },
            { name: 'Footer Text', value: branding.footerText || '*Not set*', inline: false }
          );

        if (branding.botAvatar) {
          embed.setThumbnail(branding.botAvatar);
          embed.addFields({ name: 'Avatar', value: '*(shown as thumbnail)*', inline: true });
        } else {
          embed.addFields({ name: 'Avatar', value: '*Not set*', inline: true });
        }

        embed.setFooter({ text: branding.footerText || 'Powered by Tournament Bot' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'set-name') {
        if (!value) {
          return interaction.reply({
            content: '❌ Please provide a name: `/subscribe branding action:set-name value:My Tournament Bot`',
            ephemeral: true,
          });
        }

        if (value.length > 32) {
          return interaction.reply({
            content: '❌ Bot name must be 32 characters or less.',
            ephemeral: true,
          });
        }

        await updateBranding(interaction.guildId, { botName: value });

        return interaction.reply({
          content: `✅ Bot name set to **${value}**. This will appear in tournament embeds.`,
          ephemeral: true,
        });
      }

      if (action === 'set-avatar') {
        if (!value) {
          return interaction.reply({
            content: '❌ Please provide an image URL: `/subscribe branding action:set-avatar value:https://...`',
            ephemeral: true,
          });
        }

        // Validate URL format
        try {
          new URL(value);
        } catch {
          return interaction.reply({
            content: '❌ Invalid URL format. Please provide a valid image URL.',
            ephemeral: true,
          });
        }

        if (!value.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i) && !value.includes('cdn.discordapp.com')) {
          return interaction.reply({
            content: '❌ URL should be a direct link to an image (PNG, JPG, GIF, or WebP).',
            ephemeral: true,
          });
        }

        await updateBranding(interaction.guildId, { botAvatar: value });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ Avatar Updated')
          .setDescription('Your custom avatar has been set.')
          .setThumbnail(value);

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'set-color') {
        if (!value) {
          return interaction.reply({
            content: '❌ Please provide a hex color: `/subscribe branding action:set-color value:#FF5733`',
            ephemeral: true,
          });
        }

        // Validate hex color
        const hexColor = value.startsWith('#') ? value : `#${value}`;
        if (!/^#[0-9A-Fa-f]{6}$/.test(hexColor)) {
          return interaction.reply({
            content: '❌ Invalid hex color. Use format like `#FF5733` or `FF5733`.',
            ephemeral: true,
          });
        }

        await updateBranding(interaction.guildId, { accentColor: hexColor });

        const embed = new EmbedBuilder()
          .setColor(parseInt(hexColor.replace('#', ''), 16))
          .setTitle('✅ Accent Color Updated')
          .setDescription(`Your accent color has been set to **${hexColor}**.`)
          .setFooter({ text: 'This color will be used in tournament embeds.' });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === 'set-footer') {
        if (!value) {
          return interaction.reply({
            content: '❌ Please provide footer text: `/subscribe branding action:set-footer value:Powered by MyOrg`',
            ephemeral: true,
          });
        }

        if (value.length > 100) {
          return interaction.reply({
            content: '❌ Footer text must be 100 characters or less.',
            ephemeral: true,
          });
        }

        await updateBranding(interaction.guildId, { footerText: value });

        return interaction.reply({
          content: `✅ Footer text set to: "${value}"`,
          ephemeral: true,
        });
      }

      if (action === 'reset') {
        await clearBranding(interaction.guildId);

        return interaction.reply({
          content: '✅ All branding settings have been reset to defaults.',
          ephemeral: true,
        });
      }
    }

    // Fallback for unknown subcommand
    return interaction.reply({
      content: `❌ Unknown subcommand: ${subcommand}`,
      ephemeral: true,
    });
  },
};
