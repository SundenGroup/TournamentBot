const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  const stat = fs.statSync(folderPath);

  if (stat.isDirectory()) {
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      const command = require(filePath);
      if ('data' in command) {
        commands.push(command.data.toJSON());
      }
    }
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

const args = process.argv.slice(2);
const isGuild = args.includes('--guild');
const guildId = args.find((a, i) => args[i - 1] === '--guild') || '1178369502900142100';

(async () => {
  try {
    if (isGuild) {
      console.log(`Deploying ${commands.length} commands to guild ${guildId} (instant)...`);
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
        { body: commands },
      );
      console.log(`Successfully reloaded ${data.length} guild commands.`);
    } else {
      console.log(`Deploying ${commands.length} commands globally (may take up to 1 hour)...`);
      const data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands },
      );
      console.log(`Successfully reloaded ${data.length} global commands.`);
    }
  } catch (error) {
    console.error(error);
  }
})();
