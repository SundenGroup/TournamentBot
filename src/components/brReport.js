// Battle Royale tap-to-report — placements by select menus, never by typing.
//
// Entry: the "🎮 Game N" buttons on each lobby's standings board
// (lifecycleService.buildBRBoard). Flow, all in one ephemeral message:
//
//   Who placed #1? → pick → Who placed #2? → … → ✅ Done (auto-fill rest)
//
// Reporting the top 3–5 is enough — unreported teams share last place
// automatically. Tapping an already-reported game runs the same flow as a
// CORRECTION. If the scoring model counts kills, the confirmation offers a
// tap-only kills entry (pick team → pick kill count).
//
// customId space:
//   brReport:<tid>:<key>:<game>:start|pick|page:<p>|undo|done|cancel
//   brReport:<tid>:<key>:<game>:kills|killteam|killcount:<teamId>|killsdone
// where <key> = group index or 'f' (finals).

const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');

// In-progress picks, keyed per admin+game. In-memory: a restart mid-report
// just means re-tapping a few names.
const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;

function sessionKey(userId, tid, key, game) {
  return `${userId}:${tid}:${key}:${game}`;
}

function getSession(k) {
  sweep();
  return sessions.get(k) || null;
}

function sweep() {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.at > SESSION_TTL_MS) sessions.delete(k);
  }
}

function teamName(t) {
  return t.name || t.username || 'Unknown';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th';
  return `${n}${s}`;
}

function usesKills(bracket) {
  return (bracket.scoring?.killPoints || 0) > 0 || !!bracket.scoring?.killMultipliers;
}

// ─── Placement picker UI ──────────────────────────────────────────────────────

function buildPicker(tournament, stage, key, gameNumber, sess) {
  const picked = sess.picks;
  const pickedSet = new Set(picked);
  const remaining = stage.teams.filter(t => !pickedSet.has(t.id));
  const nextPlace = picked.length + 1;
  const base = `brReport:${tournament.id}:${key}:${gameNumber}`;

  let content = `${sess.mode === 'correct' ? '🛠️ **Correcting**' : '🎮 **Reporting**'} — **${stage.name} · Game ${gameNumber}**\n`;
  if (picked.length === 0) {
    content += `Tap teams in finish order. Top 3–5 is enough — the rest share last place automatically.\n`;
  }
  if (picked.length > 0) {
    const byId = new Map(stage.teams.map(t => [t.id, t]));
    content += '\n' + picked.map((id, i) => `**${ordinal(i + 1)}:** ${teamName(byId.get(id))}`).join('\n') + '\n';
  }

  const rows = [];

  if (remaining.length > 0) {
    const pages = Math.ceil(remaining.length / 25);
    const page = Math.min(sess.page || 0, pages - 1);
    const slice = remaining.slice(page * 25, page * 25 + 25);

    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${base}:pick`)
        .setPlaceholder(`Who placed ${ordinal(nextPlace)}?${pages > 1 ? ` (page ${page + 1}/${pages})` : ''}`)
        .addOptions(slice.map(t => ({ label: teamName(t).slice(0, 100), value: t.id })))
    ));

    if (pages > 1) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${base}:page:${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`${base}:page:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
      ));
    }
  }

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${base}:done`)
      .setLabel(remaining.length > 0 ? '✅ Done — auto-fill the rest' : '✅ Save results')
      .setStyle(ButtonStyle.Success)
      .setDisabled(picked.length === 0),
    new ButtonBuilder()
      .setCustomId(`${base}:undo`)
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(picked.length === 0),
    new ButtonBuilder()
      .setCustomId(`${base}:cancel`)
      .setLabel('✖️ Cancel')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(actionRow);

  return { content, components: rows };
}

// ─── Kills picker UI ──────────────────────────────────────────────────────────

function buildKillsPicker(tournament, stage, key, gameNumber, sess) {
  const base = `brReport:${tournament.id}:${key}:${gameNumber}`;
  const game = stage.games.find(g => g.gameNumber === gameNumber);
  const kills = game?.kills || {};

  let content = `🔫 **Kills — ${stage.name} · Game ${gameNumber}**\nPick a ${tournament.settings.teamSize === 1 ? 'player' : 'team'}, then their kill count. Repeat as needed.\n`;
  const withKills = stage.teams.filter(t => kills[t.id] > 0);
  if (withKills.length > 0) {
    content += '\n' + withKills.map(t => `**${teamName(t)}:** ${kills[t.id]} kills`).join(' · ') + '\n';
  }

  const rows = [];
  const pages = Math.ceil(stage.teams.length / 25);
  const page = Math.min(sess.page || 0, pages - 1);
  const slice = stage.teams.slice(page * 25, page * 25 + 25);

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${base}:killteam`)
      .setPlaceholder(`Add kills for…${pages > 1 ? ` (page ${page + 1}/${pages})` : ''}`)
      .addOptions(slice.map(t => ({
        label: teamName(t).slice(0, 80) + (kills[t.id] ? ` — ${kills[t.id]} kills` : ''),
        value: t.id,
      })))
  ));

  if (sess.killTeam) {
    const t = stage.teams.find(x => x.id === sess.killTeam);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${base}:killcount:${sess.killTeam}`)
        .setPlaceholder(`Kills for ${teamName(t).slice(0, 60)}`)
        .addOptions(Array.from({ length: 25 }, (_, i) => ({ label: `${i} kill${i === 1 ? '' : 's'}`, value: String(i) })))
    ));
  }

  const nav = new ActionRowBuilder();
  if (pages > 1) {
    nav.addComponents(
      new ButtonBuilder().setCustomId(`${base}:killpage:${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`${base}:killpage:${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    );
  }
  nav.addComponents(
    new ButtonBuilder().setCustomId(`${base}:killsdone`).setLabel('✅ Done').setStyle(ButtonStyle.Success)
  );
  rows.push(nav);

  return { content, components: rows };
}

// ─── Confirmation after commit ───────────────────────────────────────────────

function buildSummary(tournament, stage, key, gameNumber, result, mode) {
  const bracket = tournament.bracket;
  const game = stage.games.find(g => g.gameNumber === gameNumber);
  const byId = new Map(stage.teams.map(t => [t.id, t]));
  const medals = ['🥇', '🥈', '🥉'];

  let content = `✅ **${stage.name} · Game ${gameNumber} ${mode === 'correct' ? 'corrected' : 'recorded'}!**\n\n`;
  game.reported.slice(0, 3).forEach((id, i) => {
    content += `${medals[i]} ${teamName(byId.get(id))}\n`;
  });
  const autoFilled = stage.teams.length - game.reported.length;
  if (autoFilled > 0) content += `*${autoFilled} unplaced ${tournament.settings.teamSize === 1 ? 'players' : 'teams'} share last place.*\n`;

  if (result.finalsCreated) {
    content += `\n🚀 **All groups done — the Grand Finals lobby has been created!**`;
  }
  if (result.finalsRegenerated) {
    content += `\n♻️ Grand Finals roster updated from the corrected standings.`;
  }
  if (result.tournamentComplete) {
    const { getResults } = require('../services/battleRoyaleService');
    const champ = getResults(bracket)?.winner;
    content += `\n🏆 **Tournament complete!** Champion: **${champ ? teamName(champ) : 'Unknown'}**`;
  }

  const rows = [];
  if (usesKills(bracket) && !result.tournamentComplete) {
    content += `\n\n🔫 This scoring counts kills — add them now or any time before the next stage.`;
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`brReport:${tournament.id}:${key}:${gameNumber}:kills`)
        .setLabel('🔫 Add kills')
        .setStyle(ButtonStyle.Primary)
    ));
  } else if (usesKills(bracket) && result.tournamentComplete) {
    content += `\n\n🔫 Kills can still be added from the web dashboard if needed.`;
  }

  return { content, components: rows };
}

// ─── Shared context loading ───────────────────────────────────────────────────

async function loadContext(interaction, tid, key) {
  const tournament = await getTournament(tid);
  if (!tournament || !tournament.bracket || tournament.bracket.type !== 'battle_royale') {
    return { error: 'This tournament is no longer running.' };
  }
  if (!(await canManageTournaments(interaction.member))) {
    return { error: 'Only tournament admins can report results.' };
  }
  const { getBRStage } = require('../services/lifecycleService');
  const stage = getBRStage(tournament.bracket, key);
  if (!stage) return { error: 'This lobby no longer exists.' };
  return { tournament, stage };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = {
  customId: 'brReport',

  async execute(interaction, args) {
    const [tid, key, gameStr, action, extra] = args;
    const gameNumber = parseInt(gameStr, 10);

    const ctx = await loadContext(interaction, tid, key);
    if (ctx.error) {
      return interaction.reply({ content: `❌ ${ctx.error}`, ephemeral: true }).catch(() => {});
    }
    const { tournament, stage } = ctx;
    const bracket = tournament.bracket;
    const sk = sessionKey(interaction.user.id, tid, key, gameNumber);

    // ── entry: board button ──
    if (action === 'start') {
      const game = stage.games.find(g => g.gameNumber === gameNumber);
      if (!game) return interaction.reply({ content: '❌ Game not found.', ephemeral: true });

      const mode = game.status === 'complete' ? 'correct' : 'report';
      if (mode === 'correct') {
        // The engine enforces the real rule; fail fast with its message.
        const finalsStarted = bracket.finals?.games.some(g => g.status === 'complete');
        if (key !== 'f' && !bracket.singleLobby && bracket.finals && finalsStarted) {
          return interaction.reply({ content: '❌ Group results can no longer be corrected — the Grand Finals already have reported games.', ephemeral: true });
        }
      }

      const sess = { picks: [], page: 0, mode, at: Date.now() };
      sessions.set(sk, sess);
      return interaction.reply({ ...buildPicker(tournament, stage, key, gameNumber, sess), ephemeral: true });
    }

    // ── kills entry (from the post-commit summary) ──
    if (action === 'kills') {
      const sess = { page: 0, killTeam: null, at: Date.now() };
      sessions.set(sk, sess);
      return interaction.update(buildKillsPicker(tournament, stage, key, gameNumber, sess)).catch(() =>
        interaction.reply({ ...buildKillsPicker(tournament, stage, key, gameNumber, sess), ephemeral: true }));
    }

    const sess = getSession(sk);
    if (!sess) {
      return interaction.update({
        content: '⌛ This report timed out. Tap the game button on the standings board to start again.',
        components: [],
      }).catch(() => {});
    }
    sess.at = Date.now();

    switch (action) {
      case 'pick': {
        const id = interaction.values[0];
        if (!sess.picks.includes(id)) sess.picks.push(id);
        sess.page = 0;
        // Everyone placed → commit immediately
        if (sess.picks.length >= stage.teams.length) {
          return commit(interaction, tournament, stage, key, gameNumber, sess, sk);
        }
        return interaction.update(buildPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'page': {
        sess.page = Math.max(0, parseInt(extra, 10) || 0);
        return interaction.update(buildPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'undo': {
        sess.picks.pop();
        return interaction.update(buildPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'cancel': {
        sessions.delete(sk);
        return interaction.update({ content: '✖️ Report cancelled — nothing was saved.', components: [] });
      }

      case 'done': {
        if (sess.picks.length === 0) {
          return interaction.update(buildPicker(tournament, stage, key, gameNumber, sess));
        }
        return commit(interaction, tournament, stage, key, gameNumber, sess, sk);
      }

      // ── kills flow ──
      case 'killteam': {
        sess.killTeam = interaction.values[0];
        return interaction.update(buildKillsPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'killpage': {
        sess.page = Math.max(0, parseInt(extra, 10) || 0);
        return interaction.update(buildKillsPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'killcount': {
        const teamId = extra;
        const count = parseInt(interaction.values[0], 10);
        await interaction.deferUpdate();
        try {
          const { applyBRSetKills } = require('../services/lifecycleService');
          await applyBRSetKills({
            client: interaction.client,
            tournament,
            groupKey: key,
            gameNumber,
            kills: { [teamId]: count },
          });
        } catch (error) {
          sessions.delete(sk);
          return interaction.editReply({ content: `❌ ${error.message}`, components: [] });
        }
        sess.killTeam = null;
        return interaction.editReply(buildKillsPicker(tournament, stage, key, gameNumber, sess));
      }

      case 'killsdone': {
        sessions.delete(sk);
        return interaction.update({
          content: `✅ Kills saved for **${stage.name} · Game ${gameNumber}**. Standings are up to date.`,
          components: [],
        });
      }
    }
  },
};

/** Commit picks as a report or correction and render the confirmation. */
async function commit(interaction, tournament, stage, key, gameNumber, sess, sk) {
  await interaction.deferUpdate();
  sessions.delete(sk);

  const { applyBRGameReport, applyBRGameCorrection } = require('../services/lifecycleService');
  try {
    const fn = sess.mode === 'correct' ? applyBRGameCorrection : applyBRGameReport;
    const result = await fn({
      client: interaction.client,
      guild: interaction.guild,
      tournament,
      groupKey: key,
      gameNumber,
      placements: sess.picks,
      // corrections keep previously-entered kills for still-placed teams
      kills: sess.mode === 'correct'
        ? Object.fromEntries(Object.entries(stage.games.find(g => g.gameNumber === gameNumber)?.kills || {})
            .filter(([id]) => stage.teams.some(t => t.id === id)))
        : {},
    });
    return interaction.editReply(buildSummary(tournament, stage, key, gameNumber, result, sess.mode));
  } catch (error) {
    console.error('BR report commit failed:', error);
    return interaction.editReply({ content: `❌ ${error.message}`, components: [] });
  }
}
