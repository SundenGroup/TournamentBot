const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkFeature, getEffectiveTier, getUpgradeEmbed } = require('../../services/subscriptionService');
const {
  getTemplates,
  getTemplate,
  getTemplateByName,
  deleteTemplate,
  getTemplateListEmbed,
  getTemplateDetailEmbed,
  createTemplateFromTournament,
  MAX_TEMPLATES_PER_GUILD,
} = require('../../services/templateService');
const { getTournament, getTournamentsByGuild } = require('../../services/tournamentService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('templates')
    .setDescription('Manage tournament templates (Pro feature)')
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('View all saved templates')
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View details of a specific template')
        .addStringOption(opt =>
          opt
            .setName('name')
            .setDescription('Template name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('save')
        .setDescription('Save a tournament\'s settings as a template')
        .addStringOption(opt =>
          opt
            .setName('tournament')
            .setDescription('Tournament to save as template')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt
            .setName('name')
            .setDescription('Template name (max 32 characters)')
            .setRequired(true)
            .setMaxLength(32)
        )
        .addStringOption(opt =>
          opt
            .setName('description')
            .setDescription('Optional description')
            .setMaxLength(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a template')
        .addStringOption(opt =>
          opt
            .setName('name')
            .setDescription('Template name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    // Pro feature gate
    const featureCheck = checkFeature(interaction.guildId, 'tournament_templates');
    if (!featureCheck.allowed) {
      return interaction.reply(getUpgradeEmbed('tournament_templates', getEffectiveTier(interaction.guildId)));
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const embed = getTemplateListEmbed(interaction.guildId);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'view') {
      const name = interaction.options.getString('name');
      const template = getTemplateByName(interaction.guildId, name);

      if (!template) {
        return interaction.reply({
          content: `❌ Template "${name}" not found.`,
          ephemeral: true,
        });
      }

      const embed = getTemplateDetailEmbed(template);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'save') {
      const tournamentId = interaction.options.getString('tournament');
      const name = interaction.options.getString('name');
      const description = interaction.options.getString('description');

      const tournament = getTournament(tournamentId);
      if (!tournament) {
        return interaction.reply({
          content: '❌ Tournament not found.',
          ephemeral: true,
        });
      }

      const result = createTemplateFromTournament(
        interaction.guildId,
        tournament,
        name,
        description,
        interaction.user.id
      );

      if (!result.success) {
        return interaction.reply({
          content: `❌ ${result.error}`,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Template Saved')
        .setDescription(`Template **${name}** has been created from "${tournament.title}".`)
        .addFields(
          { name: 'Game', value: result.template.gameDisplayName || 'Custom', inline: true },
          { name: 'Format', value: result.template.format, inline: true },
          { name: 'Team Size', value: result.template.teamSize === 1 ? 'Solo' : `${result.template.teamSize}v${result.template.teamSize}`, inline: true }
        )
        .setFooter({ text: 'Use /tournament create-advanced and select this template to use it' });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'delete') {
      const name = interaction.options.getString('name');
      const template = getTemplateByName(interaction.guildId, name);

      if (!template) {
        return interaction.reply({
          content: `❌ Template "${name}" not found.`,
          ephemeral: true,
        });
      }

      deleteTemplate(interaction.guildId, template.id);

      return interaction.reply({
        content: `✅ Template **${name}** has been deleted.`,
        ephemeral: true,
      });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const subcommand = interaction.options.getSubcommand();

    if (focused.name === 'name') {
      // Autocomplete template names
      const templates = getTemplates(interaction.guildId);
      const filtered = templates
        .filter(t => t.name.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25)
        .map(t => ({
          name: `${t.name} (${t.gameDisplayName || 'Custom'})`,
          value: t.name,
        }));

      return interaction.respond(filtered);
    }

    if (focused.name === 'tournament') {
      // Autocomplete tournament names
      const tournaments = getTournamentsByGuild(interaction.guildId);
      const filtered = tournaments
        .filter(t => t.title.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25)
        .map(t => ({
          name: `${t.game?.icon || '🎮'} ${t.title} (${t.status})`,
          value: t.id,
        }));

      return interaction.respond(filtered);
    }
  },
};
