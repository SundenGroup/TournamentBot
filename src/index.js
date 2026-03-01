const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');

// Global error handlers to prevent crashes
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// Initialize collections
client.commands = new Collection();
client.buttons = new Collection();
client.selectMenus = new Collection();
client.modals = new Collection();

// Load commands
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
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
      }
    }
  }
}

// Load components (buttons, select menus, modals)
const componentsPath = path.join(__dirname, 'components');
const componentFiles = fs.readdirSync(componentsPath).filter(file => file.endsWith('.js'));

for (const file of componentFiles) {
  const filePath = path.join(componentsPath, file);
  const component = require(filePath);

  if ('customId' in component && 'execute' in component) {
    // Determine component type based on file name or customId
    const name = component.customId;

    // Register for all types - the interactionCreate handler will route appropriately
    client.buttons.set(name, component);
    client.selectMenus.set(name, component);
    client.modals.set(name, component);

    console.log(`Loaded component: ${name}`);
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }

  console.log(`Loaded event: ${event.name}`);
}

// ============================================================================
// Startup: Connect to database, run migrations, then login
// ============================================================================

async function start() {
  // 1. Connect to database and run migrations
  const db = require('./db');
  try {
    // Test connection
    await db.raw('SELECT 1');
    console.log('Database connected successfully');

    // Run pending migrations
    const [batch, migrations] = await db.migrate.latest();
    if (migrations.length > 0) {
      console.log(`Ran ${migrations.length} migration(s) (batch ${batch}):`);
      migrations.forEach(m => console.log(`  - ${path.basename(m)}`));
    } else {
      console.log('Database migrations up to date');
    }
  } catch (error) {
    console.error('Database connection/migration failed:', error.message);
    process.exit(1);
  }

  // 2. Load data caches from database
  const { loadTournaments, loadServerSettings } = require('./data/store');
  try {
    await loadTournaments();
    await loadServerSettings();
  } catch (error) {
    console.error('Failed to load data from database:', error.message);
    process.exit(1);
  }

  // 3. Login to Discord
  if (!config.discord.token) {
    console.error('Missing DISCORD_TOKEN in environment variables');
    process.exit(1);
  }

  await client.login(config.discord.token);

  // 4. Start API server for Stripe webhooks and Business tier REST API
  const { startApiServer } = require('./api');
  startApiServer(process.env.API_PORT || 3000);
}

start().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});
