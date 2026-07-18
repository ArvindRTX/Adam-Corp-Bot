import client from './src/bot/index.js';
import { startServer } from './src/server/index.js';
import readyEvent from './src/bot/events/ready.js';
import interactionCreateEvent from './src/bot/events/interactionCreate.js';
import guildMemberAddEvent from './src/bot/events/guildMemberAdd.js';
import messageCreateEvent from './src/bot/events/messageCreate.js';
import config from './src/config.js';
import db from './src/database/db.js';

// Attach event handlers to the client
client.once(readyEvent.name, (...args) => readyEvent.execute(...args));
client.on(interactionCreateEvent.name, (...args) => interactionCreateEvent.execute(...args));
client.on(guildMemberAddEvent.name, (...args) => guildMemberAddEvent.execute(...args));
client.on(messageCreateEvent.name, (...args) => messageCreateEvent.execute(...args));

// Handle process termination cleanly
process.on('SIGINT', () => {
  console.log('\n[App INFO] Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[App INFO] Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Main bootsrap function
async function main() {
  console.log('[App INFO] Starting Adam Corp payment automation system...');
  
  // 1. Initialize database file
  await db.init();

  // 2. Start Webhook server (injects client for access to guild members & DMs)
  startServer(client);

  // 3. Log Discord bot client in
  if (config.discord.token && config.discord.token !== 'YOUR_DISCORD_TOKEN') {
    console.log('[Bot INFO] Connecting to Discord Gateway...');
    await client.login(config.discord.token);
  } else {
    console.warn('[Bot WARNING] DISCORD_TOKEN is not configured. Running Webhook server only. Configure credentials in your .env file to enable bot features.');
  }
}

main().catch(err => {
  console.error('[App FATAL] Unhandled bootstrap failure:', err);
  process.exit(1);
});
