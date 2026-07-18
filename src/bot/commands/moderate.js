import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import db from '../../database/db.js';
import config, { hasAllowedRole } from '../../config.js';

export const moderateCommand = {
  data: new SlashCommandBuilder()
    .setName('moderate')
    .setDescription('Perform moderation actions (Staff/Admin only)')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('kick')
        .setDescription('Kick a member from the server')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('Select the member to kick')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the kick')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('Select the member to ban')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the ban')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('timeout')
        .setDescription('Put a user in timeout (mute)')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('Select the member to mute')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('duration_minutes')
            .setDescription('Duration of timeout in minutes')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(40320) // Discord max timeout is 28 days (40320 minutes)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the timeout')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('untimeout')
        .setDescription('Remove timeout (unmute) from a user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('Select the member to unmute')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for untimeout')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('purge')
        .setDescription('Bulk delete messages from the current channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to clear (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

  async execute(interaction) {
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    let isStaff = false;
    try {
      isStaff = hasAllowedRole(interaction.member);
    } catch (e) {}

    // Allow Owner, Admin, and authorized roles to run moderation actions
    if (!isOwner && !isAdmin && !isStaff) {
      return interaction.reply({
        content: '❌ **Permission Denied**: This command is restricted to members with authorized roles or Administrator permissions.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    // Resolve target member for member-specific operations
    let targetMember = null;
    if (targetUser) {
      try {
        targetMember = await interaction.guild.members.fetch(targetUser.id);
      } catch (e) {
        return interaction.reply({
          content: '❌ **Error**: The specified user is not in this server.',
          ephemeral: true
        });
      }
    }

    // Role Hierarchy check (exempting Owner)
    if (targetMember && !isOwner) {
      const isTargetOwner = interaction.guild.ownerId === targetUser.id;
      const isTargetAdmin = targetMember.permissions.has(PermissionFlagsBits.Administrator);
      
      if (isTargetOwner || (isTargetAdmin && !isOwner)) {
        return interaction.reply({
          content: '❌ **Error**: You cannot perform moderation actions on this user due to role hierarchy.',
          ephemeral: true
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const config = await db.getAntiRaidConfig();
      const alertChannel = config.alertChannelId ? await interaction.guild.channels.fetch(config.alertChannelId).catch(() => null) : null;

      // 1. Purge Subcommand
      if (subcommand === 'purge') {
        const amount = interaction.options.getInteger('amount');
        
        // Fetch and delete messages
        const deleted = await interaction.channel.bulkDelete(amount, true);
        
        const responseText = `🧹 **Purged ${deleted.size} messages** from <#${interaction.channelId}> (messages older than 14 days cannot be bulk deleted).`;
        await interaction.editReply({ content: responseText });

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🧹 Messages Purged')
            .setColor('#FFA500')
            .addFields(
              { name: 'Staff Member', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true },
              { name: 'Amount Requested', value: `\`${amount}\``, inline: true },
              { name: 'Amount Cleared', value: `\`${deleted.size}\``, inline: true }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return;
      }

      // 2. Kick Subcommand
      if (subcommand === 'kick') {
        await targetMember.kick(`Moderation: ${reason}`);
        await interaction.editReply({
          content: `✅ Successfully kicked **${targetUser.tag}**.`
        });

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Member Kicked')
            .setColor('#FFA500')
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Reason', value: `\`${reason}\`` }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return;
      }

      // 3. Ban Subcommand
      if (subcommand === 'ban') {
        await targetMember.ban({ reason: `Moderation: ${reason}` });
        await interaction.editReply({
          content: `✅ Successfully banned **${targetUser.tag}**.`
        });

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Member Banned')
            .setColor('#FF0000')
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Reason', value: `\`${reason}\`` }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return;
      }

      // 4. Timeout Subcommand
      if (subcommand === 'timeout') {
        const durationMinutes = interaction.options.getInteger('duration_minutes');
        const durationMs = durationMinutes * 60 * 1000;

        await targetMember.timeout(durationMs, `Moderation: ${reason}`);
        await interaction.editReply({
          content: `✅ Timed out **${targetUser.tag}** for **${durationMinutes} minutes**.`
        });

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Member Timed Out')
            .setColor('#FF0000')
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Duration', value: `\`${durationMinutes} minutes\``, inline: true },
              { name: 'Reason', value: `\`${reason}\`` }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return;
      }

      // 5. Untimeout Subcommand
      if (subcommand === 'untimeout') {
        await targetMember.timeout(null, `Moderation: ${reason}`);
        await interaction.editReply({
          content: `✅ Removed timeout from **${targetUser.tag}**.`
        });

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Member Untimed Out')
            .setColor('#00FF00')
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Reason', value: `\`${reason}\`` }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return;
      }

    } catch (err) {
      console.error('[moderateCommand Error]', err);
      return interaction.editReply({
        content: `❌ **Operation Failed**: ${err.message}`
      });
    }
  }
};
