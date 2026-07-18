import { REST, Routes } from 'discord.js';
import config from '../../config.js';
import { invoiceCommand } from '../commands/invoice.js';
import { checkStatusCommand } from '../commands/check-status.js';
import { cancelInvoiceCommand } from '../commands/cancel-invoice.js';
import { announceCommand } from '../commands/announce.js';
import { moderationCommand } from '../commands/moderation.js';
import { moderateCommand } from '../commands/moderate.js';
import { addprefixCommand } from '../commands/addprefix.js';
import { removeprefixCommand } from '../commands/removeprefix.js';
import { replaceprefixCommand } from '../commands/replaceprefix.js';
import { resetnicknamesCommand } from '../commands/resetnicknames.js';


export default {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot INFO] Logged in as ${client.user.tag}!`);
    
    // Register commands in client collection
    client.commands.set(invoiceCommand.data.name, invoiceCommand);
    client.commands.set(checkStatusCommand.data.name, checkStatusCommand);
    client.commands.set(cancelInvoiceCommand.data.name, cancelInvoiceCommand);
    client.commands.set(announceCommand.data.name, announceCommand);
    client.commands.set(moderationCommand.data.name, moderationCommand);
    client.commands.set(moderateCommand.data.name, moderateCommand);
    client.commands.set(addprefixCommand.data.name, addprefixCommand);
    client.commands.set(removeprefixCommand.data.name, removeprefixCommand);
    client.commands.set(replaceprefixCommand.data.name, replaceprefixCommand);
    client.commands.set(resetnicknamesCommand.data.name, resetnicknamesCommand);
    
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    
    try {
      const commandData = [
        invoiceCommand.data.toJSON(),
        checkStatusCommand.data.toJSON(),
        cancelInvoiceCommand.data.toJSON(),
        announceCommand.data.toJSON(),
        moderationCommand.data.toJSON(),
        moderateCommand.data.toJSON(),
        addprefixCommand.data.toJSON(),
        removeprefixCommand.data.toJSON(),
        replaceprefixCommand.data.toJSON(),
        resetnicknamesCommand.data.toJSON()
      ];
      
      console.log(`[Bot INFO] Started refreshing ${commandData.length} application (/) commands.`);
      
      if (config.discord.guildId && config.discord.guildId !== 'YOUR_GUILD_ID') {
        // Register to specific Guild for instant updates
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
          { body: commandData }
        );
        console.log(`[Bot INFO] Successfully reloaded application (/) commands for Guild: ${config.discord.guildId}`);
      } else {
        // Register globally
        await rest.put(
          Routes.applicationCommands(config.discord.clientId),
          { body: commandData }
        );
        console.log('[Bot INFO] Successfully reloaded global application (/) commands.');
      }
    } catch (error) {
      console.error('[Bot ERROR] Failed to register slash commands:', error);
    }
  }
};
