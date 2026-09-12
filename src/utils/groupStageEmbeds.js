// Discord embeds for a Group Stage tournament: one ranked table per group
// (two groups per embed to stay under Discord's 10-embed cap), tiebreak
// explanations, and a compact playoff listing once the playoffs exist. The
// order comes from the engine's getGroupStandings — the same call that
// decides who qualifies — so Discord, the web page and the dashboard can
// never disagree about who finished where.
const { EmbedBuilder } = require('discord.js');
const groupStage = require('../services/groupStageService');

const nameOf = (tournament, p) => (tournament.settings.teamSize === 1 ? (p.displayName || p.username) : p.name) || 'TBD';

function groupTable(tournament, g) {
  const adv = tournament.bracket.playoffFormat === 'none' ? 0 : (tournament.bracket.advancingPerGroup || 0);
  const trackGoals = tournament.settings.trackGoals !== false;
  let out = '```\n';
  out += `#  ${'Player'.padEnd(18)} W-L  Diff${trackGoals ? '   GD' : ''}\n`;
  g.standings.forEach((s, i) => {
    const gd = (s.gamesWon || 0) - (s.gamesLost || 0);
    const goals = (s.goalsFor || 0) - (s.goalsAgainst || 0);
    const fmt = n => (n > 0 ? `+${n}` : String(n)).padStart(4);
    const mark = adv && i < adv ? '↑' : ' ';
    out += `${String(i + 1).padStart(1)}${mark} ${nameOf(tournament, s.participant).slice(0, 18).padEnd(18)} ${s.wins}-${s.losses}  ${fmt(gd)}${trackGoals ? ` ${fmt(goals)}` : ''}\n`;
  });
  out += '```\n';
  for (const n of g.notes || []) {
    out += `↕ ${nameOf(tournament, n.ahead)} ahead of ${nameOf(tournament, n.behind)} on **${n.on}**\n`;
  }
  return out;
}

function playoffLines(po) {
  const roundSets = po.rounds ? [['', po.rounds]] : [
    ['Winners bracket', po.winnersRounds || []], ['Losers bracket', po.losersRounds || []], ['Grand finals', po.grandFinalsRounds || []],
  ];
  let out = '';
  for (const [label, rounds] of roundSets) {
    if (label && rounds.length) out += `__${label}__\n`;
    for (const round of rounds) {
      if (round.isReset && !po.needsReset) continue;
      out += `**${round.name || `Round ${round.round}`}**\n`;
      for (const m of round.matches) {
        if (m.isReset && !po.needsReset) continue;
        const p1 = m.participant1 ? (m.participant1.displayName || m.participant1.username || m.participant1.name) : 'TBD';
        const p2 = m.participant2 ? (m.participant2.displayName || m.participant2.username || m.participant2.name) : 'TBD';
        const w = m.winner ? ` ✓ ${m.winner.displayName || m.winner.username || m.winner.name}${m.score ? ` (${m.score})` : ''}${m.isDQ ? ' · DQ' : ''}` : '';
        out += `#${m.matchNumber}: ${p1} vs ${p2}${w}\n`;
      }
    }
  }
  const tp = po.thirdPlaceMatch;
  if (tp) {
    const p1 = tp.participant1 ? (tp.participant1.displayName || tp.participant1.username || tp.participant1.name) : 'TBD';
    const p2 = tp.participant2 ? (tp.participant2.displayName || tp.participant2.username || tp.participant2.name) : 'TBD';
    const w = tp.winner ? ` ✓ ${tp.winner.displayName || tp.winner.username || tp.winner.name}${tp.score ? ` (${tp.score})` : ''}` : '';
    out += `**Bronze match**\n#${tp.matchNumber}: ${p1} vs ${p2}${w}\n`;
  }
  return out;
}

function buildGroupStageEmbeds(tournament) {
  const bracket = tournament.bracket;
  const groups = groupStage.getGroupStandings(bracket);
  const embeds = [];
  const adv = bracket.playoffFormat === 'none' ? 0 : bracket.advancingPerGroup;
  for (let i = 0; i < groups.length; i += 2) {
    const pair = groups.slice(i, i + 2);
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — ${pair.map(g => g.name).join(' · ')}`)
      .setColor(0x5865f2)
      .setDescription(pair.map(g => `**${g.name}**${g.complete ? ' · ✓ done' : ''}\n${groupTable(tournament, g)}`).join('\n').slice(0, 4000));
    if (i === 0) {
      embed.setFooter({ text: adv ? `↑ top ${adv} per group advance · Diff = games won−lost · GD = goal difference` : 'Final group tables decide the tournament' });
    }
    embeds.push(embed);
  }
  if (bracket.playoffs) {
    embeds.push(new EmbedBuilder()
      .setTitle(`🏆 ${tournament.title} — Playoffs`)
      .setColor(0x2ecc71)
      .setDescription(playoffLines(bracket.playoffs).slice(0, 4000) || 'Waiting for qualifiers'));
  }
  return embeds.slice(0, 9); // leave room for the web-link embed
}

module.exports = { buildGroupStageEmbeds };
