// Bye / walkover notifications.
//
// Byes exist at bracket generation (non-power-of-2 fields, Swiss odd rounds)
// and walkovers appear mid-tournament in double elimination (a losers-bracket
// slot fed by a bye never gets an opponent). Without this, the only way a
// player learns they advanced without playing is by reading the bracket — so:
//
//   getStartByeSummary()      — one-line summary for the start confirmation
//   notifyByesAndWalkovers()  — DMs every newly advanced player/team once,
//                               marking matches byeNotified (caller persists
//                               the bracket afterwards, which saves the flags)

const { getBracketUrl } = require('./embedBuilder');

function collectAllMatches(bracket) {
  if (!bracket) return [];
  const matches = [];
  const roundGroups = bracket.type === 'double_elimination'
    ? [bracket.winnersRounds, bracket.losersRounds, bracket.grandFinalsRounds]
    : [bracket.rounds];
  for (const rounds of roundGroups) {
    for (const round of rounds || []) {
      matches.push(...(round.matches || []));
    }
  }
  return matches;
}

/** Matches where someone advanced without playing: generation byes + DE walkovers. */
function getByeMatches(bracket) {
  return collectAllMatches(bracket).filter(m => (m.isBye || m.isWalkover) && m.winner);
}

/**
 * One-line bye summary for the tournament-start confirmation, or null if the
 * bracket starts with no byes.
 */
function getStartByeSummary(tournament) {
  const byes = getByeMatches(tournament.bracket);
  if (byes.length === 0) return null;

  const isSolo = tournament.settings.teamSize === 1;
  const recipients = byes.map(m => m.winner);
  const names = recipients.map(p => (isSolo ? p.username : p.name) || 'Unknown');
  const nameList = names.length > 8 ? `${names.slice(0, 8).join(', ')}, …` : names.join(', ');

  const seeds = recipients.map(p => p.seed).filter(s => s != null);
  let basis;
  if (seeds.length === recipients.length) {
    const lo = Math.min(...seeds);
    const hi = Math.max(...seeds);
    basis = `seeds ${lo}–${hi}`;
  } else {
    basis = 'signup order — use Seeding + `/tournament seed` to control who gets them';
  }

  return `🎟️ **${byes.length} bye${byes.length > 1 ? 's' : ''}** (${basis}): ${nameList}`;
}

/**
 * DM everyone who advanced via a not-yet-notified bye/walkover, then flag the
 * matches so repeat calls (and re-reports) never double-DM. Returns the number
 * of matches notified. The caller is expected to persist the bracket after.
 */
async function notifyByesAndWalkovers(client, tournament) {
  const bracket = tournament.bracket;
  if (!bracket) return 0;

  const isSolo = tournament.settings.teamSize === 1;
  const bracketUrl = getBracketUrl(tournament);
  let notified = 0;

  for (const match of getByeMatches(bracket)) {
    if (match.byeNotified) continue;
    match.byeNotified = true;
    notified++;

    const advanced = match.winner;
    const name = (isSolo ? advanced.username : advanced.name) || 'You';
    const kind = match.isWalkover ? 'walkover' : 'bye';
    let message = `🎟️ **${kind === 'bye' ? 'Bye' : 'Walkover'}!** ${isSolo ? 'You' : `Your team **${name}**`} advanced in **${tournament.title}** without playing ${match.roundName ? `(${match.roundName})` : 'this round'} — no opponent in your bracket slot.`;
    if (bracketUrl) message += `\n🌐 Bracket: ${bracketUrl}`;

    // Resolve who to DM: the participant, or every resolved team member.
    const userIds = [];
    if (isSolo) {
      if (advanced.id && !String(advanced.id).startsWith('fake_')) userIds.push(advanced.id);
    } else {
      for (const member of advanced.members || []) {
        if (member.id && !String(member.id).startsWith('fake_')) userIds.push(member.id);
      }
    }

    for (const userId of userIds) {
      try {
        const user = await client.users.fetch(userId);
        await user.send(message);
      } catch {
        // DMs closed or user gone — ignore
      }
    }
  }

  return notified;
}

module.exports = {
  getStartByeSummary,
  notifyByesAndWalkovers,
};
