const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('./embedBuilder');

// Coalesce announcement edits: at check-in scale (500+ entrants), hundreds of
// players press the button within minutes and every press used to queue its
// own edit of the SAME two messages. Discord allows roughly one edit per
// second per message, so the queue grew to many minutes — and every command
// that refreshes the announcement (add-player, admin check-in, seed, …) hung
// at the tail of it, stuck on "thinking…". Callers now return immediately and
// the FRESHEST tournament state is flushed at most once per interval per
// tournament — a burst of 300 clicks becomes a handful of edits.
const EDIT_INTERVAL_MS = 4000;
const state = new Map(); // tournamentId -> { lastEditAt, timer, next }

async function performEdit(client, tournament) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);

    if (tournament.messageId) {
      const mainMessage = await channel.messages.fetch(tournament.messageId);
      const embed = await createTournamentEmbed(tournament);
      const buttons = createTournamentButtons(tournament);
      await mainMessage.edit({ embeds: [embed], components: buttons });
    }

    if (tournament.participantListMessageId) {
      const listMessage = await channel.messages.fetch(tournament.participantListMessageId);
      const participantEmbed = await createParticipantListEmbed(tournament);
      await listMessage.edit({ embeds: [participantEmbed] });
    }
  } catch (error) {
    console.error('Error updating tournament messages:', error);
  }
}

async function updateTournamentMessages(client, tournament) {
  const id = tournament.id;
  let s = state.get(id);
  if (!s) {
    // Entries persist after flushing — lastEditAt is what makes the throttle
    // work (deleting it would make every post-flush call "leading edge"
    // again). Bounded: purge long-idle entries when the map grows.
    if (state.size > 200) {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [k, v] of state) {
        if (!v.timer && !v.next && v.lastEditAt < cutoff) state.delete(k);
      }
    }
    s = { lastEditAt: 0, timer: null, next: null };
    state.set(id, s);
  }

  s.next = { client, tournament }; // always keep the freshest state

  if (s.timer) return; // a flush is already scheduled and will pick up s.next

  const since = Date.now() - s.lastEditAt;
  const wait = since >= EDIT_INTERVAL_MS ? 0 : EDIT_INTERVAL_MS - since;

  s.timer = setTimeout(async () => {
    const { client: c, tournament: t } = s.next;
    s.next = null;
    s.lastEditAt = Date.now();
    await performEdit(c, t);
    s.timer = null;
    if (s.next) {
      // Newer state arrived while editing — schedule the follow-up flush
      updateTournamentMessages(s.next.client, s.next.tournament);
    }
  }, wait);
  if (s.timer.unref) s.timer.unref();
}

module.exports = {
  updateTournamentMessages,
};
