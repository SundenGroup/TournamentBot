// Local dev/preview server for the public bracket page.
// Generates realistic fixtures with the REAL bracket engines (no DB, no
// Discord) and serves bracket.html against them:
//
//   node scripts/bracket-preview.js   →  http://localhost:4100
//
//   /b/se        single elim, 13 players, mid-tournament
//   /b/de        double elim, 13 players, mid-tournament
//   /b/swiss     swiss, 9 players, round 2 of 4
//   /b/rr        round robin, 6 players, mid-tournament
//   /b/reg       registration phase (no bracket yet)
//   /b/done      completed double elim with podium

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const singleElim = require('../src/services/singleEliminationService');
const doubleElim = require('../src/services/doubleEliminationService');
const swiss = require('../src/services/swissService');
const roundRobin = require('../src/services/roundRobinService');
const { buildPayload } = require('../src/api/publicBracket');

const NAMES = ['Nova', 'Frostbite', 'Apex_Andy', 'Shadowfang', 'QuickShot', 'Zenith', 'Volt', 'Rampage',
  'IceQueen', 'Bullseye', 'Phantom', 'Drifter', 'Sledge', 'Wraith', 'Tempest', 'Onyx'];

function players(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, username: NAMES[i] || `Player${i + 1}`, displayName: NAMES[i] || `Player${i + 1}`, seed: i + 1,
  }));
}

function playSome(service, bracket, count) {
  let played = 0;
  while (played < count) {
    const active = service.getActiveMatches(bracket);
    if (!active.length) {
      if (service.isRoundComplete && !service.isComplete(bracket)) {
        try { service.generateNextRound(bracket); continue; } catch { break; }
      }
      break;
    }
    const m = active[0];
    const winner = Math.random() > 0.4 ? m.participant1 : m.participant2;
    service.advanceWinner(bracket, m.id, winner.id, `${2}-${Math.floor(Math.random() * 2)}`);
    played++;
  }
  return bracket;
}

function playAll(service, bracket) {
  let guard = 0;
  while (!service.isComplete(bracket) && guard++ < 1000) {
    const active = service.getActiveMatches(bracket);
    if (!active.length) break;
    for (const m of active) service.advanceWinner(bracket, m.id, m.participant1.id, '2-1');
  }
  return bracket;
}

// Build a fake DB-shaped tournament and run it through the REAL public-API
// payload builder, so previews exercise the exact production pipeline
// (sanitization, results computation, everything).
function basePayload(over) {
  const fakeTournament = {
    id: over.id,
    title: over.title,
    description: null,
    status: over.status ?? 'active',
    startTime: new Date(Date.now() + 86400000),
    game: { displayName: 'Rocket League', shortName: 'RL', icon: '🚗', logo: 'https://cdn.discordapp.com/emojis/1514008017979576370.png?size=128' },
    settings: {
      format: over.format, teamSize: 1, bestOf: 3,
      maxParticipants: 16, publicBracket: true,
    },
    participants: players(over.count),
    teams: [],
    bracket: over.bracket ?? null,
  };
  return buildPayload(fakeTournament);
}

const FIXTURES = {};

{ const b = playSome(singleElim, singleElim.generateBracket(players(13), {}), 7);
  FIXTURES.se = basePayload({ id: 'se', title: 'Friday Night Cup', format: 'single_elimination', count: 13, bracket: b }); }

{ const b = playSome(singleElim, singleElim.generateBracket(players(8), { thirdPlaceMatch: true }), 6);
  FIXTURES.tp = basePayload({ id: 'tp', title: 'Cup with 3rd Place Match', format: 'single_elimination', count: 8, bracket: b }); }

{ const b = playSome(doubleElim, doubleElim.generateBracket(players(13), {}), 11);
  FIXTURES.de = basePayload({ id: 'de', title: 'Clutch Major — Double Elim', format: 'double_elimination', count: 13, bracket: b }); }

{ const b = swiss.generateBracket(players(9), {});
  playSome(swiss, b, 7);
  FIXTURES.swiss = basePayload({ id: 'swiss', title: 'Weekly Swiss Open', format: 'swiss', count: 9, bracket: b }); }

{ const b = playSome(roundRobin, roundRobin.generateBracket(players(6), {}), 8);
  FIXTURES.rr = basePayload({ id: 'rr', title: 'Round Robin League', format: 'round_robin', count: 6, bracket: b }); }

FIXTURES.reg = basePayload({ id: 'reg', title: 'Sunday Showdown', format: 'double_elimination', count: 11, status: 'registration' });

{ const b = playAll(doubleElim, doubleElim.generateBracket(players(8), {}));
  // results are computed by buildPayload itself (bracket is complete)
  FIXTURES.done = basePayload({ id: 'done', title: 'Season Finale', format: 'double_elimination', count: 8, status: 'completed', bracket: b }); }

// Big-bracket stress fixture for the v2 layout engine (256 players, mid-run)
{ const many = Array.from({ length: 256 }, (_, i) => ({
    id: `p${i + 1}`, username: `${NAMES[i % 16]}_${i + 1}`, displayName: `${NAMES[i % 16]}_${i + 1}`, seed: i + 1,
  }));
  const b = doubleElim.generateBracket(many, {});
  let played = 0;
  while (played < 300) {
    const active = doubleElim.getActiveMatches(b);
    if (!active.length) break;
    const m = active[0];
    doubleElim.advanceWinner(b, m.id, (Math.random() > 0.4 ? m.participant1 : m.participant2).id, '2-1');
    played++;
  }
  const fakeBig = {
    id: 'big', title: 'CLUTCH Open 2026', description: null, status: 'active',
    startTime: new Date(Date.now() + 86400000),
    game: { displayName: 'Counter-Strike 2', shortName: 'CS2', icon: '🎯', logo: 'https://cdn.discordapp.com/emojis/1514008006134599702.png?size=128' },
    settings: { format: 'double_elimination', teamSize: 1, bestOf: 3, maxParticipants: 256, publicBracket: true },
    participants: many, teams: [], bracket: b,
  };
  FIXTURES.big = buildPayload(fakeBig); }

const template = fs.readFileSync(path.join(__dirname, '../public/bracket.html'), 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath.startsWith('/b/')) {
    const id = urlPath.slice(3);
    const html = template
      .replaceAll('{{TITLE}}', 'Preview').replaceAll('{{DESCRIPTION}}', 'Preview')
      .replaceAll('{{BASE}}', 'http://localhost:4100')
      .replaceAll('{{DATA_URL}}', `/api/public/brackets/${id}`)
      .replaceAll('{{TOURNAMENT_ID}}', id);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  if (urlPath.startsWith('/api/public/brackets/')) {
    const id = urlPath.split('/').pop();
    const fx = FIXTURES[id];
    if (!fx) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(fx));
  }
  if (urlPath === '/clutch-icon.png' || urlPath === '/clutch-wordmark.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(fs.readFileSync(path.join(__dirname, '../public', urlPath)));
  }
  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<body style="font-family:sans-serif"><h3>Bracket previews</h3>' +
      Object.keys(FIXTURES).map(k => `<p><a href="/b/${k}">/b/${k}</a></p>`).join('') + '</body>');
  }
  res.writeHead(404); res.end('not found');
});

server.listen(4100, () => console.log('Bracket preview on http://localhost:4100'));
