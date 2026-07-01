// Shared "what happens next" suffix for signup confirmations, so players
// aren't left with a bare "you're signed up" and no idea when to show up.

const { toDiscordFullAndRelative } = require('./timeUtils');

function signupNextSteps(tournament) {
  const lines = [];
  if (tournament.startTime) {
    lines.push(`🗓️ Starts ${toDiscordFullAndRelative(tournament.startTime)}`);
  }
  if (tournament.settings?.checkinRequired) {
    lines.push(`⏰ Check-in opens ${tournament.settings.checkinWindow} minutes before start — watch for the ping, or you'll be dropped from the bracket.`);
  }
  if (tournament.channelId) {
    lines.push(`📣 Updates are posted in <#${tournament.channelId}>.`);
  }
  return lines.length ? '\n' + lines.join('\n') : '';
}

module.exports = { signupNextSteps };
