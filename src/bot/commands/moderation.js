import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import db from '../../database/db.js';

export const moderationCommand = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Configure or view bot anti-raid and security settings (Admin/Owner only)')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Display the current anti-raid and moderation status')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('lockdown')
        .setDescription('Manually enable or disable server join lockdown')
        .addBooleanOption(option =>
          option.setName('state')
            .setDescription('Set lockdown state (True = Enabled, False = Disabled)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('alertchannel')
        .setDescription('Set the channel where security alerts and logs are sent')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Select the text log channel')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('config')
        .setDescription('Update anti-raid rules and trigger limits')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable or disable anti-raid checks globally')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option.setName('block_links')
            .setDescription('Block and delete invite links / URLs')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option.setName('min_account_age_hours')
            .setDescription('Kicks members with accounts younger than this (in hours)')
            .setRequired(false)
            .setMinValue(0)
        )
        .addIntegerOption(option =>
          option.setName('max_mentions')
            .setDescription('Threshold for pings in a single message before a timeout')
            .setRequired(false)
            .setMinValue(1)
        )
        .addIntegerOption(option =>
          option.setName('spam_limit')
            .setDescription('Max messages allowed in window before a timeout')
            .setRequired(false)
            .setMinValue(1)
        )
        .addIntegerOption(option =>
          option.setName('spam_window_seconds')
            .setDescription('Time window for spam tracking (in seconds)')
            .setRequired(false)
            .setMinValue(1)
        )
        .addIntegerOption(option =>
          option.setName('join_limit')
            .setDescription('Joins limit before triggers auto-lockdown')
            .setRequired(false)
            .setMinValue(1)
        )
        .addIntegerOption(option =>
          option.setName('join_window_seconds')
            .setDescription('Time window for join rates tracking (in seconds)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: '❌ **Permission Denied**: This command is restricted to server Administrators or the Server Owner.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    try {
      const config = await db.getAntiRaidConfig();

      if (subcommand === 'status') {
        const embed = new EmbedBuilder()
          .setTitle('🛡️ Security & Anti-Raid Guard Status')
          .setDescription('Current live state of server defenses and auto-moderation settings.')
          .setColor(config.enabled ? (config.lockdown ? '#FF0000' : '#43B581') : '#747F8D') // Red if lockdown, green if enabled, grey if disabled
          .addFields(
            { name: 'Global Protection Status', value: config.enabled ? '🟢 **ENABLED**' : '🔴 **DISABLED**', inline: true },
            { name: 'Invite Lockdown Mode', value: config.lockdown ? '🚨 **LOCKED DOWN**' : '🟢 **NORMAL**', inline: true },
            { name: 'Mod Logs / Alerts Channel', value: config.alertChannelId ? `<#${config.alertChannelId}>` : '`None Configured`', inline: true },
            { name: 'Link/Invite Filter', value: config.blockLinks ? '🛡️ Active' : '🔓 Inactive', inline: true },
            { name: 'Account Age Requirement', value: `\`${config.minAccountAgeHours} hours\``, inline: true },
            { name: 'Max Allowed Mentions', value: `\`${config.maxMentions} pings/msg\``, inline: true },
            { name: 'Anti-Spam Limit', value: `\`${config.spamLimit} msgs / ${config.spamWindowSeconds}s\``, inline: true },
            { name: 'Anti-Join Raid Threshold', value: `\`${config.joinLimit} joins / ${config.joinWindowSeconds}s\``, inline: true }
          )
          .setFooter({ text: 'Adam Corp Automated Security Shield' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'lockdown') {
        const state = interaction.options.getBoolean('state');
        await db.updateAntiRaidConfig({ lockdown: state });

        const embed = new EmbedBuilder()
          .setTitle(state ? '🚨 Invites Locked Down' : '🔓 Invites Resumed')
          .setDescription(state 
            ? 'Server is in **Emergency Lockdown**. All new members joining the server will be immediately kicked.' 
            : 'Lockdown disabled. Members can now join standard invitation entries.'
          )
          .setColor(state ? '#FF0000' : '#00FF00')
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'alertchannel') {
        const channel = interaction.options.getChannel('channel');
        if (!channel.isTextBased()) {
          return interaction.editReply({
            content: '❌ **Error**: The selected channel is not text-based.'
          });
        }

        await db.updateAntiRaidConfig({ alertChannelId: channel.id });
        return interaction.editReply({
          content: `✅ Moderation logs and security alerts will now be dispatched to <#${channel.id}>.`
        });
      }

      if (subcommand === 'config') {
        const enabled = interaction.options.getBoolean('enabled');
        const blockLinks = interaction.options.getBoolean('block_links');
        const minAccountAgeHours = interaction.options.getInteger('min_account_age_hours');
        const maxMentions = interaction.options.getInteger('max_mentions');
        const spamLimit = interaction.options.getInteger('spam_limit');
        const spamWindowSeconds = interaction.options.getInteger('spam_window_seconds');
        const joinLimit = interaction.options.getInteger('join_limit');
        const joinWindowSeconds = interaction.options.getInteger('join_window_seconds');

        const updates = {};
        if (enabled !== null) updates.enabled = enabled;
        if (blockLinks !== null) updates.blockLinks = blockLinks;
        if (minAccountAgeHours !== null) updates.minAccountAgeHours = minAccountAgeHours;
        if (maxMentions !== null) updates.maxMentions = maxMentions;
        if (spamLimit !== null) updates.spamLimit = spamLimit;
        if (spamWindowSeconds !== null) updates.spamWindowSeconds = spamWindowSeconds;
        if (joinLimit !== null) updates.joinLimit = joinLimit;
        if (joinWindowSeconds !== null) updates.joinWindowSeconds = joinWindowSeconds;

        const updatedConfig = await db.updateAntiRaidConfig(updates);

        const embed = new EmbedBuilder()
          .setTitle('⚙️ Security Config Updated')
          .setDescription('Successfully saved changes to security system parameters.')
          .setColor('#43B581')
          .addFields(
            { name: 'Global Protection', value: updatedConfig.enabled ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Block Links', value: updatedConfig.blockLinks ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Min Account Age', value: `\`${updatedConfig.minAccountAgeHours} hours\``, inline: true },
            { name: 'Max Mentions', value: `\`${updatedConfig.maxMentions}\``, inline: true },
            { name: 'Spam Rate Limit', value: `\`${updatedConfig.spamLimit} msgs / ${updatedConfig.spamWindowSeconds}s\``, inline: true },
            { name: 'Join Rate Limit', value: `\`${updatedConfig.joinLimit} joins / ${updatedConfig.joinWindowSeconds}s\``, inline: true }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error('[moderationCommand Error]', err);
      return interaction.editReply({
        content: `❌ **Failed to update config**: ${err.message}`
      });
    }
  }
};
