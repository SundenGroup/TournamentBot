const { EmbedBuilder } = require('discord.js');
const { getTournament } = require('../services/tournamentService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');

module.exports = {
  customId: 'viewBracket',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    if (!tournament.bracket) {
      return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
    }

    const bracket = tournament.bracket;
    const isSolo = tournament.settings.teamSize === 1;
    const getName = (p) => isSolo ? p?.username : p?.name;

    const embeds = [];

    if (bracket.type === 'swiss') {
      // Swiss format - show standings and current round matches
      const standings = swiss.getStandings(bracket);

      const standingsEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Swiss Standings`)
        .setColor(0xe67e22);

      let standingsText = `**Round ${bracket.currentRound} of ${bracket.totalRounds}**\n\n`;
      standingsText += '```\n';
      standingsText += 'Rank  Player              W-L   Pts  Buch\n';
      standingsText += '─'.repeat(48) + '\n';

      // Limit to top 25 to avoid exceeding Discord limits
      const displayStandings = standings.slice(0, 25);
      displayStandings.forEach((s, i) => {
        const name = getName(s.participant) || 'Unknown';
        const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name.padEnd(18);
        const record = `${s.wins}-${s.losses}`.padEnd(5);
        const points = String(s.points).padEnd(4);
        const buchholz = String(s.buchholz);
        standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${points} ${buchholz}\n`;
      });
      standingsText += '```';

      if (standings.length > 25) {
        standingsText += `\n*...and ${standings.length - 25} more participants*`;
      }

      standingsEmbed.setDescription(standingsText);
      embeds.push(standingsEmbed);

      // Show current round matches
      const currentRound = bracket.rounds[bracket.currentRound - 1];
      if (currentRound) {
        const matchesEmbed = new EmbedBuilder()
          .setTitle(`Round ${bracket.currentRound} Matches`)
          .setColor(0xe67e22);

        let matchesText = '';
        for (const match of currentRound.matches) {
          const p1 = getName(match.participant1) || 'BYE';
          const p2 = getName(match.participant2) || 'BYE';
          const status = match.winner ? `✓ ${getName(match.winner)}` : (match.isBye ? '(bye)' : '');
          matchesText += `**#${match.matchNumber}:** ${p1} vs ${p2} ${status}\n`;
        }

        matchesEmbed.setDescription(matchesText || 'No matches');
        embeds.push(matchesEmbed);
      }

    } else if (bracket.type === 'round_robin') {
      // Round Robin format - show standings
      const standings = roundRobin.getStandings(bracket);

      const standingsEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Round Robin Standings`)
        .setColor(0x1abc9c);

      let standingsText = `**Round ${bracket.currentRound} of ${bracket.totalRounds}**\n\n`;
      standingsText += '```\n';
      standingsText += 'Rank  Player              W-L   Played\n';
      standingsText += '─'.repeat(44) + '\n';

      // Limit to top 25 to avoid exceeding Discord limits
      const displayStandings = standings.slice(0, 25);
      displayStandings.forEach((s, i) => {
        const name = getName(s.participant) || 'Unknown';
        const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name.padEnd(18);
        const record = `${s.wins}-${s.losses}`.padEnd(5);
        const played = String(s.matchesPlayed);
        standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${played}\n`;
      });
      standingsText += '```';

      if (standings.length > 25) {
        standingsText += `\n*...and ${standings.length - 25} more participants*`;
      }

      standingsEmbed.setDescription(standingsText);
      embeds.push(standingsEmbed);

      // Show current round matches
      const currentRound = bracket.rounds.find(r => r.status === 'active');
      if (currentRound) {
        const matchesEmbed = new EmbedBuilder()
          .setTitle(`Round ${currentRound.roundNumber} Matches`)
          .setColor(0x1abc9c);

        let matchesText = '';
        for (const match of currentRound.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const status = match.winner ? `✓ ${getName(match.winner)}` : '';
          matchesText += `**#${match.matchNumber}:** ${p1} vs ${p2} ${status}\n`;
        }

        matchesEmbed.setDescription(matchesText || 'No matches');
        embeds.push(matchesEmbed);
      }

    } else if (bracket.type === 'single_elimination') {
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Bracket`)
        .setColor(0x3498db);

      let description = '';
      for (const round of bracket.rounds) {
        description += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? `✓ ${getName(match.winner)}` : '';

          if (match.isBye) {
            description += `#${match.matchNumber}: ${p1} (bye)\n`;
          } else {
            description += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
          }
        }
        description += '\n';
      }

      embed.setDescription(description.substring(0, 4000));
      embeds.push(embed);

    } else if (bracket.type === 'battle_royale') {
      // Battle Royale format - show group standings and games
      const standings = battleRoyale.getStandings(bracket);
      const stageTitle = bracket.currentStage === 'finals' ? 'Grand Finals' : 'Group Stage';

      const mainEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — ${stageTitle}`)
        .setColor(0xff6b35);

      if (bracket.currentStage === 'groups') {
        // Show group standings
        let mainDesc = '';
        for (const group of standings.groups) {
          mainDesc += `**${group.name}** (${group.gamesComplete}/${group.totalGames} games)\n`;
          mainDesc += '```\n';
          mainDesc += 'Rank Team             Pts  Games\n';
          mainDesc += '─'.repeat(34) + '\n';

          const displayStandings = group.standings.slice(0, 10);
          displayStandings.forEach((s, i) => {
            const name = getName(s.team) || 'Unknown';
            const displayName = name.length > 15 ? name.substring(0, 12) + '...' : name.padEnd(15);
            const pts = String(s.points).padEnd(4);
            const games = String(s.gamesPlayed);
            const advancing = i < standings.advancingPerGroup ? '→' : ' ';
            mainDesc += `${String(i + 1).padStart(2)}${advancing} ${displayName} ${pts} ${games}\n`;
          });
          mainDesc += '```\n';
        }

        if (mainDesc.length > 4000) {
          mainDesc = mainDesc.substring(0, 3900) + '\n...truncated';
        }
        mainEmbed.setDescription(mainDesc);
        mainEmbed.setFooter({ text: `→ = advancing to finals (top ${standings.advancingPerGroup} per group)` });

      } else if (bracket.currentStage === 'finals' && standings.finals) {
        // Show finals standings
        let finalsDesc = `**Finals** (${standings.finals.gamesComplete}/${standings.finals.totalGames} games)\n\n`;
        finalsDesc += '```\n';
        finalsDesc += 'Rank Team             Pts  Games  From\n';
        finalsDesc += '─'.repeat(44) + '\n';

        const displayStandings = standings.finals.standings.slice(0, 20);
        displayStandings.forEach((s, i) => {
          const name = getName(s.team) || 'Unknown';
          const displayName = name.length > 15 ? name.substring(0, 12) + '...' : name.padEnd(15);
          const pts = String(s.points).padEnd(4);
          const games = String(s.gamesPlayed).padEnd(5);
          const from = (s.team.qualifiedFrom || '').substring(0, 5);
          finalsDesc += `${String(i + 1).padStart(2)}   ${displayName} ${pts} ${games}  ${from}\n`;
        });
        finalsDesc += '```';

        mainEmbed.setDescription(finalsDesc);

      } else if (bracket.currentStage === 'complete') {
        const results = battleRoyale.getResults(bracket);
        let completeDesc = '🏆 **Tournament Complete!**\n\n';

        if (results) {
          const winnerName = getName(results.winner);
          const runnerUpName = getName(results.runnerUp);
          const thirdName = getName(results.thirdPlace);

          completeDesc += `🥇 **Champion:** ${winnerName}\n`;
          completeDesc += `🥈 **Runner-up:** ${runnerUpName}\n`;
          if (thirdName) completeDesc += `🥉 **3rd Place:** ${thirdName}\n`;
        }

        mainEmbed.setDescription(completeDesc);
      }

      embeds.push(mainEmbed);

      // Show active games
      const activeGames = battleRoyale.getActiveMatches(bracket);
      if (activeGames.length > 0) {
        const gamesEmbed = new EmbedBuilder()
          .setTitle('Pending Games')
          .setColor(0xff6b35);

        let gamesDesc = '';
        for (const game of activeGames.slice(0, 10)) {
          gamesDesc += `**${game.groupName}** - Game ${game.gameNumber} (${game.teamCount} teams)\n`;
        }
        if (activeGames.length > 10) {
          gamesDesc += `\n*...and ${activeGames.length - 10} more games*`;
        }

        gamesEmbed.setDescription(gamesDesc);
        embeds.push(gamesEmbed);
      }

    } else if (bracket.type === 'double_elimination') {
      // Winners bracket
      const wbEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Winners Bracket`)
        .setColor(0x2ecc71);

      let wbDesc = '';
      for (const round of bracket.winnersRounds) {
        wbDesc += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? `✓ ${getName(match.winner)}` : '';

          if (match.isBye) {
            wbDesc += `#${match.matchNumber}: ${p1} (bye)\n`;
          } else {
            wbDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
          }
        }
        wbDesc += '\n';
      }
      wbEmbed.setDescription(wbDesc.substring(0, 4000));
      embeds.push(wbEmbed);

      // Losers bracket
      const lbEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Losers Bracket`)
        .setColor(0xe74c3c);

      let lbDesc = '';
      for (const round of bracket.losersRounds) {
        lbDesc += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? `✓ ${getName(match.winner)}` : '';
          lbDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
        }
        lbDesc += '\n';
      }
      lbEmbed.setDescription(lbDesc.substring(0, 4000) || 'No matches yet');
      embeds.push(lbEmbed);

      // Grand Finals
      const gfEmbed = new EmbedBuilder()
        .setTitle(`📊 ${tournament.title} — Grand Finals`)
        .setColor(0xf1c40f);

      let gfDesc = '';
      for (const round of bracket.grandFinalsRounds) {
        const match = round.matches[0];
        if (match.isReset && !bracket.needsReset) continue;

        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const winner = match.winner ? `✓ ${getName(match.winner)}` : '';
        gfDesc += `**${round.name}**\n`;
        gfDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n\n`;
      }
      gfEmbed.setDescription(gfDesc || 'Waiting for finalists');
      embeds.push(gfEmbed);
    }

    return interaction.reply({ embeds, ephemeral: true });
  },
};
