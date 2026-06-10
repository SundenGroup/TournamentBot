// Modal submit handler for /tournament edit.
// Editable: title, date/time, max participants, best-of, description.
// Never editable: game, format, team size (changing them after signups would
// invalidate existing registrations).

const { getTournament, updateTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const { scheduleReminders } = require('../services/reminderService');
const { parseDateTime, toDiscordFullAndRelative } = require('../utils/timeUtils');

module.exports = {
  customId: 'editTournament',
  async execute(interaction, args) {
    // DB write + announcement edits + reminder rescheduling can exceed the
    // 3s ack window, so defer immediately.
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.editReply({ content: '❌ Tournament not found.' });
    }

    if (!(await canManageTournaments(interaction.member))) {
      return interaction.editReply({ content: '❌ Only tournament admins can edit tournaments.' });
    }

    if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
      return interaction.editReply({ content: '❌ This tournament has already started and can no longer be edited.' });
    }

    const isSolo = tournament.settings.teamSize === 1;
    const entrantCount = isSolo ? tournament.participants.length : tournament.teams.length;

    // ── Parse & validate inputs ────────────────────────────────────────────
    const title = interaction.fields.getTextInputValue('title').trim();
    const datetimeStr = interaction.fields.getTextInputValue('datetime').trim();
    const maxParticipantsStr = interaction.fields.getTextInputValue('maxParticipants').trim();
    const bestOfStr = interaction.fields.getTextInputValue('bestOf').trim();
    const description = interaction.fields.getTextInputValue('description').trim();

    const startTime = parseDateTime(datetimeStr);
    if (!startTime) {
      return interaction.editReply({
        content: '❌ Could not parse the date/time. Use a format like `2026-06-10 18:00 UTC` or `Jun 10 6pm UTC`.',
      });
    }

    const maxParticipants = parseInt(maxParticipantsStr, 10);
    if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 512) {
      return interaction.editReply({ content: '❌ Max participants must be a number between 2 and 512.' });
    }
    if (maxParticipants < entrantCount) {
      return interaction.editReply({
        content: `❌ Max ${isSolo ? 'players' : 'teams'} can't be lower than the current signup count (${entrantCount}).`,
      });
    }

    const bestOf = parseInt(bestOfStr, 10);
    if (isNaN(bestOf) || bestOf < 1 || bestOf > 15 || bestOf % 2 === 0) {
      return interaction.editReply({ content: '❌ Best Of must be an odd number between 1 and 15 (e.g. 1, 3, 5, 7).' });
    }

    // ── Diff against current values for the confirmation summary ──────────
    const changes = [];
    if (title !== tournament.title) changes.push(`**Title:** ${tournament.title} → ${title}`);
    const oldStart = new Date(tournament.startTime).getTime();
    const dateChanged = startTime.getTime() !== oldStart;
    if (dateChanged) changes.push(`**Date:** ${toDiscordFullAndRelative(tournament.startTime)} → ${toDiscordFullAndRelative(startTime)}`);
    if (maxParticipants !== tournament.settings.maxParticipants) {
      changes.push(`**Max ${isSolo ? 'players' : 'teams'}:** ${tournament.settings.maxParticipants} → ${maxParticipants}`);
    }
    if (bestOf !== tournament.settings.bestOf) changes.push(`**Best of:** ${tournament.settings.bestOf} → ${bestOf}`);
    if ((description || null) !== (tournament.description || null)) changes.push('**Description** updated');

    if (changes.length === 0) {
      return interaction.editReply({ content: 'No changes made — everything matches the current values.' });
    }

    // ── Persist ────────────────────────────────────────────────────────────
    const settings = { ...tournament.settings, maxParticipants, bestOf };
    const updated = await updateTournament(tournamentId, {
      title,
      description: description || null,
      startTime,
      settings,
    });

    if (!updated) {
      return interaction.editReply({ content: '❌ Failed to save changes, please try again.' });
    }

    // Re-schedule reminders on date change (scheduleReminders cancels any
    // existing jobs for this tournament first).
    if (dateChanged) {
      scheduleReminders(updated, interaction.client);
    }

    // Refresh the announcement + participant list embeds in place.
    await updateTournamentMessages(interaction.client, updated);

    return interaction.editReply({
      content: `✅ **${updated.title}** updated:\n${changes.join('\n')}`,
    });
  },
};
