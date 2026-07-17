// "⚠️ Contest result" — posted in a match room together with the rolling
// auto-archive notice. Participants of that match can pause the archive and
// summon the admins; a correction or the admin "Close now" button resolves it.

const { getTournament, updateTournament } = require('../services/tournamentService');
const { findMatchById } = require('../utils/matchUtils');

module.exports = {
  customId: 'contestResult',

  async execute(interaction, args) {
    const [tournamentId, matchId] = args;
    const tournament = await getTournament(tournamentId);
    if (!tournament?.bracket) {
      return interaction.reply({ content: '❌ This tournament is no longer running.', ephemeral: true });
    }

    const found = findMatchById(tournament.bracket, matchId);
    const match = found?.match || found; // engines return the match or {match}
    if (!match) {
      return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    }

    // Only the two sides of this match may contest
    const isSolo = tournament.settings.teamSize === 1;
    const memberIds = [];
    for (const side of [match.participant1, match.participant2]) {
      if (!side) continue;
      if (isSolo) memberIds.push(side.id);
      else for (const m of side.members || []) memberIds.push(m.id);
    }
    if (!memberIds.includes(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only the players of this match can contest its result.', ephemeral: true });
    }

    if (match.contested) {
      return interaction.reply({ content: 'This result is already contested — an admin will take a look.', ephemeral: true });
    }

    match.contested = true;
    match.contestedBy = interaction.user.id;
    match.archiveAt = null; // freeze the room until an admin resolves
    await updateTournament(tournamentId, { bracket: tournament.bracket });

    // Acknowledge in the room
    await interaction.reply({
      content: `⚠️ <@${interaction.user.id}> has **contested** this result. The room stays open until an admin reviews it — admins can settle it with \`/tournament correct\` (or confirm it on the dashboard).`,
    });

    // Summon the admins in the tournament channel
    try {
      const channel = await interaction.client.channels.fetch(tournament.channelId);
      const label = `Match #${match.matchNumber ?? '?'}`;
      await channel.send(
        `⚠️ **Result contested** — ${label} of **${tournament.title}** was contested by <@${interaction.user.id}>. ` +
        `Review it in <#${match.channelId}> and settle with \`/tournament correct\` or confirm on the dashboard.`
      );
    } catch { /* announcement channel gone — room message stands */ }
  },
};
