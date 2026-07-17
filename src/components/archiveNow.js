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
    const label = `Match #${match.matchNumber ?? '?'} — ${name(match.participant1)} vs ${name(match.participant2)}`;
    const { archiveChannel } = require('../services/transcriptService');

    const res = await archiveChannel({
      guild: interaction.guild,
      tournament,
      matchKey: String(match.id),
      matchLabel: label,
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

    // The room (and our reply) is gone — confirm somewhere that survives:
    // the tournament's announcement channel.
    try {
      const channel = await interaction.client.channels.fetch(tournament.channelId);
      if (res.deleted && res.saved) {
        await channel.send(
          `🗄️ **${label}** room archived by <@${interaction.user.id}> — ${res.messageCount} messages saved. ` +
          `📜 View: web dashboard → tournament → decided matches${res.mirrored ? ', or #match-logs' : ''}.`
        );
      } else if (res.deleted && !res.saved) {
        await channel.send(
          `⚠️ **${label}** room was deleted but the chat history could **not** be saved (check the bot logs). Archived by <@${interaction.user.id}>.`
        );
      } else if (!res.deleted && !res.missing) {
        await channel.send(
          `❌ Could not archive **${label}** — the channel couldn't be deleted. Check the bot has **Manage Channels**.`
        );
      }
    } catch { /* announcement channel gone — nothing more we can do */ }
  },
};
