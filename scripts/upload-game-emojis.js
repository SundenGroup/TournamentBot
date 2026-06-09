// Uploads every image in public/logos/ as a Discord *application emoji*
// (owned by the bot application, usable in any server without guild emoji slots).
//
// Why: Discord's emoji CDN then hosts the game icons at a permanent URL
// (https://cdn.discordapp.com/emojis/<id>.png), which we use both as the
// select-menu emoji and as the embed thumbnail `logo` in src/config/games.json.
//
// Usage:  node scripts/upload-game-emojis.js
// Idempotent: an existing emoji with the same name is replaced (delete+create),
// which issues a NEW id — paste the printed mapping back into games.json after
// any re-run.
//
// Constraints: image ≤256KB; name 2-32 chars [a-z0-9_]; Discord rescales large
// images down to its emoji box automatically.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://discord.com/api/v10';
const appId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_TOKEN;

if (!appId || !token) {
  console.error('Missing DISCORD_CLIENT_ID / DISCORD_TOKEN in environment.');
  process.exit(1);
}

const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

async function main() {
  const listRes = await fetch(`${API}/applications/${appId}/emojis`, { headers });
  const existing = (await listRes.json()).items || [];

  const dir = path.join(__dirname, '..', 'public', 'logos');
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();

  const mapping = {};
  for (const file of files) {
    const name = file.replace(/\.(png|jpe?g)$/i, '');

    const old = existing.find(e => e.name === name);
    if (old) {
      await fetch(`${API}/applications/${appId}/emojis/${old.id}`, { method: 'DELETE', headers });
      console.log(`replaced existing emoji ${name} (${old.id})`);
    }

    const buf = fs.readFileSync(path.join(dir, file));
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    const res = await fetch(`${API}/applications/${appId}/emojis`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, image: `data:${mime};base64,${buf.toString('base64')}` }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error(`FAIL ${name}: ${JSON.stringify(data)}`);
      continue;
    }
    mapping[name] = data.id;
    console.log(`uploaded ${name} -> ${data.id}`);
  }

  console.log('\nPaste into games.json (menuEmoji + logo URL per game):');
  console.log(JSON.stringify(mapping, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
