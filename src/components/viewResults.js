const { EmbedBuilder } = require('discord.js');
const { getTournament } = require('../services/tournamentService');
const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');

module.exports = {
  customId: 'viewResults',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    if (!tournament.bracket) {
      return interaction.reply({ content: '❌ No bracket data available.', ephemeral: true });
    }

    const bracket = tournament.bracket;
    const isSolo = tournament.settings.teamSize === 1;
    const getName = (p) => isSolo ? p?.username : p?.name;

    const embeds = [];

    // Get results based on format
    let service;
    switch (bracket.type) {
      case 'double_elimination':
        service = doubleElim;
        break;
      case 'swiss':
        service = swiss;
        break;
      case 'round_robin':
        service = roundRobin;
        break;
      case 'battle_royale':
        service = battleRoyale;
        break;
      default:
        service = singleElim;
    }

    const results = service.getResults(bracket);

    // Create podium embed
    const podiumEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${tournament.title} — Final Results`)
      .setColor(0xffd700);

    if (tournament.game.logo) {
      podiumEmbed.setThumbnail(tournament.game.logo);
    }

    let podiumText = '';
    if (results?.winner) {
      podiumText += `🥇 **Champion:** ${getName(results.winner)}\n`;
    }
    if (results?.runnerUp) {
      podiumText += `🥈 **Runner-up:** ${getName(results.runnerUp)}\n`;
    }
    if (results?.thirdPlace) {
      podiumText += `🥉 **3rd Place:** ${getName(results.thirdPlace)}\n`;
    }

    const formatNames = {
      single_elimination: 'Single Elimination',
      double_elimination: 'Double Elimination',
      swiss: 'Swiss',
      round_robin: 'Round Robin',
      battle_royale: 'Battle Royale',
    };

    podiumText += `\n**Format:** ${formatNames[bracket.type] || bracket.type}`;
    podiumText += `\n**Game:** ${tournament.game.icon} ${tournament.game.displayName}`;

    const participantCount = isSolo ? tournament.participants.length : tournament.teams.length;
    podiumText += `\n**Participants:** ${participantCount}`;

    podiumEmbed.setDescription(podiumText);
    embeds.push(podiumEmbed);

    // Format-specific detailed results
    if (bracket.type === 'swiss' || bracket.type === 'round_robin') {
      // Show final standings
      const standings = bracket.type === 'swiss'
        ? swiss.getStandings(bracket)
        : roundRobin.getStandings(bracket);

      const standingsEmbed = new EmbedBuilder()
        .setTitle('📊 Final Standings')
        .setColor(bracket.type === 'swiss' ? 0xe67e22 : 0x1abc9c);

      let standingsText = '```\n';
      if (bracket.type === 'swiss') {
        standingsText += 'Rank  Player              W-L   Pts  Buch\n';
        standingsText += '─'.repeat(48) + '\n';
      } else {
        standingsText += 'Rank  Player              W-L   Played\n';
        standingsText += '─'.repeat(44) + '\n';
      }

      const displayStandings = standings.slice(0, 25);
      displayStandings.forEach((s, i) => {
        const name = getName(s.participant) || 'Unknown';
        const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name.padEnd(18);
        const record = `${s.wins}-${s.losses}`.padEnd(5);

        if (bracket.type === 'swiss') {
          const points = String(s.points).padEnd(4);
          const buchholz = String(s.buchholz);
          standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${points} ${buchholz}\n`;
        } else {
          const played = String(s.matchesPlayed);
          standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${played}\n`;
        }
      });
      standingsText += '```';

      if (standings.length > 25) {
        standingsText += `\n*...and ${standings.length - 25} more participants*`;
      }

      standingsEmbed.setDescription(standingsText);
      embeds.push(standingsEmbed);

    } else if (bracket.type === 'single_elimination') {
      // Show bracket summary
      const bracketEmbed = new EmbedBuilder()
        .setTitle('📊 Bracket Results')
        .setColor(0x3498db);

      let bracketText = '';
      for (const round of bracket.rounds) {
        bracketText += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? getName(match.winner) : null;

          if (match.isBye) {
            bracketText += `#${match.matchNumber}: ${p1} (bye)\n`;
          } else {
            bracketText += `#${match.matchNumber}: ${p1} vs ${p2}`;
            if (winner) bracketText += ` → **${winner}**`;
            if (match.score) bracketText += ` (${match.score})`;
            bracketText += '\n';
          }
        }
        bracketText += '\n';
      }

      bracketEmbed.setDescription(bracketText.substring(0, 4000));
      embeds.push(bracketEmbed);

    } else if (bracket.type === 'battle_royale') {
      // Show final standings from finals
      if (bracket.finals) {
        const standingsEmbed = new EmbedBuilder()
          .setTitle('📊 Grand Finals Standings')
          .setColor(0xff6b35);

        let standingsText = '```\n';
        standingsText += 'Rank Team              Pts   Games  From\n';
        standingsText += '─'.repeat(48) + '\n';

        const displayStandings = bracket.finals.standings.slice(0, 20);
        displayStandings.forEach((s, i) => {
          const name = getName(s.team) || 'Unknown';
          const displayName = name.length > 16 ? name.substring(0, 13) + '...' : name.padEnd(16);
          const pts = String(s.points).padEnd(5);
          const games = String(s.gamesPlayed).padEnd(5);
          const from = (s.team.qualifiedFrom || '').substring(0, 6);
          standingsText += `${String(i + 1).padStart(2)}   ${displayName} ${pts} ${games}  ${from}\n`;
        });
        standingsText += '```';

        if (bracket.finals.standings.length > 20) {
          standingsText += `\n*...and ${bracket.finals.standings.length - 20} more teams*`;
        }

        standingsEmbed.setDescription(standingsText);
        embeds.push(standingsEmbed);

        // Show group stage summary
        const groupsEmbed = new EmbedBuilder()
          .setTitle('📋 Group Stage Summary')
          .setColor(0xff6b35);

        let groupsText = '';
        for (const group of bracket.groups) {
          groupsText += `**${group.name}**\n`;
          const topTeams = group.standings.slice(0, 5);
          topTeams.forEach((s, i) => {
            const name = getName(s.team) || 'Unknown';
            const marker = i < bracket.advancingPerGroup ? '→' : ' ';
            groupsText += `${marker} ${i + 1}. ${name} (${s.points} pts)\n`;
          });
          if (group.standings.length > 5) {
            groupsText += `  *+${group.standings.length - 5} more*\n`;
          }
          groupsText += '\n';
        }

        groupsEmbed.setDescription(groupsText.substring(0, 4000));
        embeds.push(groupsEmbed);
      }

    } else if (bracket.type === 'double_elimination') {
      // Winners bracket
      const wbEmbed = new EmbedBuilder()
        .setTitle('📊 Winners Bracket')
        .setColor(0x2ecc71);

      let wbText = '';
      for (const round of bracket.winnersRounds) {
        wbText += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? getName(match.winner) : null;

          if (match.isBye) {
            wbText += `#${match.matchNumber}: ${p1} (bye)\n`;
          } else {
            wbText += `#${match.matchNumber}: ${p1} vs ${p2}`;
            if (winner) wbText += ` → **${winner}**`;
            if (match.score) wbText += ` (${match.score})`;
            wbText += '\n';
          }
        }
        wbText += '\n';
      }
      wbEmbed.setDescription(wbText.substring(0, 4000) || 'No matches');
      embeds.push(wbEmbed);

      // Losers bracket
      const lbEmbed = new EmbedBuilder()
        .setTitle('📊 Losers Bracket')
        .setColor(0xe74c3c);

      let lbText = '';
      for (const round of bracket.losersRounds) {
        lbText += `**${round.name}**\n`;
        for (const match of round.matches) {
          const p1 = getName(match.participant1) || 'TBD';
          const p2 = getName(match.participant2) || 'TBD';
          const winner = match.winner ? getName(match.winner) : null;

          lbText += `#${match.matchNumber}: ${p1} vs ${p2}`;
          if (winner) lbText += ` → **${winner}**`;
          if (match.score) lbText += ` (${match.score})`;
          lbText += '\n';
        }
        lbText += '\n';
      }
      lbEmbed.setDescription(lbText.substring(0, 4000) || 'No matches');
      embeds.push(lbEmbed);

      // Grand Finals
      const gfEmbed = new EmbedBuilder()
        .setTitle('📊 Grand Finals')
        .setColor(0xf1c40f);

      let gfText = '';
      for (const round of bracket.grandFinalsRounds) {
        const match = round.matches[0];
        if (!match) continue;
        if (match.isReset && !bracket.needsReset) continue;

        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const winner = match.winner ? getName(match.winner) : null;

        gfText += `**${round.name}**\n`;
        gfText += `#${match.matchNumber}: ${p1} vs ${p2}`;
        if (winner) gfText += ` → **${winner}**`;
        if (match.score) gfText += ` (${match.score})`;
        gfText += '\n\n';
      }
      gfEmbed.setDescription(gfText || 'No grand finals data');
      embeds.push(gfEmbed);
    }

    return interaction.reply({ embeds, ephemeral: true });
  },
};
