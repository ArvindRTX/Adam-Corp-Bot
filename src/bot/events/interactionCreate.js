import { handleStatusVerification } from '../commands/check-status.js';
import { handleAnnounceModal } from '../commands/announce.js';
import { PermissionFlagsBits } from 'discord.js';
import config, { hasAllowedRole } from '../../config.js';

export default {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
      // 1. Guild Restriction: Verify interaction is inside the home guild
      if (interaction.guildId !== config.discord.guildId) {
        if (interaction.isChatInputCommand()) {
          await interaction.reply({
            content: '❌ **Access Denied**: This bot is configured to run only inside its designated home server.',
            ephemeral: true
          });
        }
        return;
      }

      // 2. Permission Check: Server Owner, Administrator, or configured roles only
      const isOwner = interaction.guild?.ownerId === interaction.user.id;
      const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

      let isStaffOrSales = false;
      try {
        const member = await interaction.guild?.members.fetch(interaction.user.id);
        isStaffOrSales = hasAllowedRole(member);
      } catch (err) {
        console.error('[Central Permission Check Error] Failed to fetch member roles:', err.message);
      }

      if (!isOwner && !isAdmin && !isStaffOrSales) {
        if (interaction.isChatInputCommand()) {
          await interaction.reply({
            content: '❌ **Access Denied**: You are not authorized to use bot commands. Access is restricted to Owners, Administrators, and authorized role members.',
            ephemeral: true
          });
        }
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.warn(`[Bot WARNING] No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        console.log(`[Interaction] User ${interaction.user.tag} ran command /${interaction.commandName}`);
        await command.execute(interaction);
      } catch (error) {
        console.error(`[Bot ERROR] Error executing command /${interaction.commandName}:`, error);
        
        const errorMessage = {
          content: '❌ There was an error while executing this command!',
          ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage).catch(err => console.error('[Bot ERROR] Failed to followUp error:', err.message));
        } else {
          await interaction.reply(errorMessage).catch(err => console.error('[Bot ERROR] Failed to reply error:', err.message));
        }
      }
    } else if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        console.error(`[Bot ERROR] Error executing autocomplete for /${interaction.commandName}:`, error);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('check_status_')) {
        const txnId = interaction.customId.replace('check_status_', '');
        console.log(`[Interaction] User ${interaction.user.tag} clicked Check Status button for ${txnId}`);
        await handleStatusVerification(interaction, txnId, true);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('announce_modal_')) {
        console.log(`[Interaction] User ${interaction.user.tag} submitted announcement modal`);
        await handleAnnounceModal(interaction);
      }
    }
  }
};
