// "🗄️ Close now" — admin shortcut on the auto-archive notice: archive this
// room (transcript + delete) immediately instead of waiting out the timer.
// Also how an admin dismisses a contest after checking the result is fine.

const { getTournament, updateTournament } = require('../services/tournamentService');
const { findMatchById } = require('../utils/matchUtils');
const { canManageTournaments } = require('../utils/permissions');

module.exports = {
  customId: 'archiveNow',

  async execute(interaction, args) {
    const [tournamentId, matchId] = args;

    if (!(await canManageTournaments(interaction.member))) {
      return interaction.reply({ content: '❌ Only tournament admins can close rooms.', ephemeral: true });
    }

    const tournament = await getTournament(tournamentId);
    if (!tournament?.bracket) {
      return interaction.reply({ content: '❌ This tournament is no longer running.', ephemeral: true });
    }

    const found = findMatchById(tournament.bracket, matchId);
    const match = found?.match || found;
    if (!match?.channelId) {
      return interaction.reply({ content: '❌ This room is already closed.', ephemeral: true });
    }

    await interaction.reply({ content: '🗄️ Archiving this room — history is being saved…' });

    const isSolo = tournament.settings.teamSize === 1;
    const name = (p) => (p ? (isSolo ? p.username : p.name) : 'TBD');
    const { archiveChannel } = require('../services/transcriptService');

    const res = await archiveChannel({
      guild: interaction.guild,
      tournament,
      matchKey: String(match.id),
      matchLabel: `Match #${match.matchNumber ?? '?'} — ${name(match.participant1)} vs ${name(match.participant2)}`,
      channelId: match.channelId,
      participants: [match.participant1, match.participant2].filter(Boolean).map(p => ({ id: p.id, name: name(p) })),
    });

    if (res.deleted || res.missing) {
      match.channelId = null;
      match.archiveAt = null;
      match.contested = false;
      match.contestedBy = null;
      await updateTournament(tournamentId, { bracket: tournament.bracket });
    }
    // The channel is gone — no follow-up edit possible (the reply died with it)
  },
};
