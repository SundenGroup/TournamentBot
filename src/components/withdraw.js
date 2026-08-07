const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament } = require('../services/tournamentService');

// Withdraw is now a two-step: this handler only shows an ephemeral confirm
// (players were fat-fingering the button and losing their checked-in spot);
// withdrawConfirm.js performs the actual withdrawal.
module.exports = {
  customId: 'withdraw',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }
    if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
      return interaction.reply({ content: '❌ Withdrawals are closed — the tournament has already started.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;
    let warning;

    if (isSolo) {
      const participant = tournament.participants.find(p => p.id === interaction.user.id);
      if (!participant) {
        return interaction.reply({ content: "❌ You're not signed up for this tournament.", ephemeral: true });
      }
      warning = `You're about to withdraw from **${tournament.title}**.`;
      if (participant.checkedIn) {
        warning += `\n⚠️ **You're already checked in** — withdrawing gives up your spot.`;
      }
    } else {
      const team = tournament.teams.find(t =>
        t.captain?.id === interaction.user.id || (t.members || []).some(m => m.id === interaction.user.id));
      if (!team) {
        return interaction.reply({ content: "❌ You're not on a team in this tournament.", ephemeral: true });
      }
      if (team.captain?.id !== interaction.user.id) {
        return interaction.reply({ content: '❌ Only the team captain can withdraw the team.', ephemeral: true });
      }
      warning = `You're about to withdraw **your whole team ${team.name}** from **${tournament.title}**.`;
      if (team.checkedIn) {
        warning += `\n⚠️ **Your team is already checked in** — withdrawing gives up its spot.`;
      }
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`withdrawConfirm:${tournamentId}`)
        .setLabel(isSolo ? 'Yes, withdraw me' : 'Yes, withdraw the team')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`withdrawCancel:${tournamentId}`)
        .setLabel('Keep my spot')
        .setEmoji('👍')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ content: warning, components: [row], ephemeral: true });
  },
};
