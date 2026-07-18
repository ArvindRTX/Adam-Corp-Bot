import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import config from '../config.js';

// Create discord client with appropriate intents and partials for DMs and Guild management
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel, // Crucial for receiving/sending direct messages
    Partials.Message,
  ],
});

// Initialize collection to store slash commands
client.commands = new Collection();

export default client;
