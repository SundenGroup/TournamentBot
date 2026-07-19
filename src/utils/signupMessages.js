// Shared "what happens next" suffix for signup confirmations, so players
// aren't left with a bare "you're signed up" and no idea when to show up.

const { toDiscordFullAndRelative } = require('./timeUtils');

function signupNextSteps(tournament) {
  const lines = [];
  if (tournament.startTime) {
    lines.push(`🗓️ Starts ${toDiscordFullAndRelative(tournament.startTime)}`);
  }
  // If they signed up during the check-in window, addParticipant/addTeam
  // already marked them present — say so instead of "check-in opens later".
  if (tournament.status === 'checkin') {
    lines.push(`✅ Check-in is open and **you're already checked in** — you're all set.`);
  } else if (tournament.settings?.checkinRequired) {
    lines.push(`⏰ Check-in opens ${tournament.settings.checkinWindow} minutes before start — watch for the ping, or you'll be dropped from the bracket.`);
  }
  if (tournament.channelId) {
    lines.push(`📣 Updates are posted in <#${tournament.channelId}>.`);
  }
  return lines.length ? '\n' + lines.join('\n') : '';
}

module.exports = { signupNextSteps };
