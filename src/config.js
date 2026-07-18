import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    roleName: process.env.ROLE_NAME || 'Verified Customer',
    roleId: process.env.ROLE_ID || null,
    allowedRoles: process.env.ALLOWED_ROLES 
      ? process.env.ALLOWED_ROLES.split(',').map(r => r.trim()).filter(Boolean)
      : ['Staff', 'Sales'],
  },
  upigateway: {
    key: process.env.UPIGATEWAY_KEY || process.env.UPIGateway_KEY,
    webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/api/payment-webhook',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  // Mapping of products to tiers and prices in INR
  products: {
    'Internal Panel': {
      '7 Days': 249,
      '14 Days': 499,
      '30 Days': 999,
      'Lifetime': 1499
    },
    'Silent Aim Max': {
      '7 Days': 249,
      'Monthly': 999,
      'Lifetime': 1999
    },
    'Location File': {
      'Lifetime': 250
    },
    'CSR Paid Push': {
      'Grandmaster Stable': 500,
      '999 Star': 1200,
      'First Day Region': 800
    },
    '1000 Protection': {
      'Fixed': 500
    },
    'Custom Amount': {
      'Custom': 0 // Calculated dynamically
    }
  },
  // Mock mode for testing in sandbox/localhost without active UPIGateway key
  isSandbox: !process.env.UPIGATEWAY_KEY || process.env.UPIGATEWAY_KEY === 'YOUR_UPIGATEWAY_KEY',
};

// Validate critical config
const missingConfig = [];
if (!config.discord.token || config.discord.token === 'YOUR_DISCORD_TOKEN') missingConfig.push('DISCORD_TOKEN');
if (!config.discord.clientId || config.discord.clientId === 'YOUR_CLIENT_ID') missingConfig.push('CLIENT_ID');
if (!config.discord.guildId || config.discord.guildId === 'YOUR_GUILD_ID') missingConfig.push('GUILD_ID');

if (missingConfig.length > 0) {
  console.warn(`[Config WARNING] Missing configuration variables: ${missingConfig.join(', ')}. Please configure them in your .env file.`);
}

if (config.isSandbox) {
  console.log('[Config INFO] UPIGateway key is missing or set to placeholder. Operating in SANDBOX/MOCK mode.');
}

/**
 * Checks if a GuildMember has any of the configured allowed roles (by name or ID)
 * @param {import('discord.js').GuildMember} member The member to check
 * @returns {boolean} True if the member has an allowed role, false otherwise
 */
export function hasAllowedRole(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  const allowed = config.discord.allowedRoles;
  return member.roles.cache.some(role => 
    allowed.some(allowedRole => 
      role.id === allowedRole || role.name.toLowerCase() === allowedRole.toLowerCase()
    )
  );
}

export default config;
