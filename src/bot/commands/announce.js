import { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  ChannelType, 
  EmbedBuilder, 
  ApplicationIntegrationType, 
  InteractionContextType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder 
} from 'discord.js';

export const announceCommand = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement or message as the bot (Admin/Staff only)')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('channel')
        .setDescription('Channel to send the announcement in (defaults to current channel)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('ping')
        .setDescription('Optional standard mention to prepend')
        .setRequired(false)
        .addChoices(
          { name: 'Everyone (@everyone)', value: 'everyone' },
          { name: 'Here (@here)', value: 'here' }
        )
    )
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Optional role to mention')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // 1. Permission Check: Server Owner or Administrator bypass only
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    let isStaffOrSales = false;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      isStaffOrSales = member.roles.cache.some(role =>
        role.name.toLowerCase() === 'staff' || role.name.toLowerCase() === 'sales'
      );
    } catch (e) {}

    if (!isOwner && !isAdmin && !isStaffOrSales) {
      return interaction.reply({
        content: '❌ **Permission Denied**: This command is restricted to Owners, Administrators, or Staff members.',
        ephemeral: true
      });
    }

    const channelInput = interaction.options.getString('channel');
    let targetChannel = interaction.channel;

    if (channelInput) {
      // Attempt to resolve by ID
      targetChannel = await interaction.guild.channels.fetch(channelInput).catch(() => null);
      
      // Fallback: search cache by name
      if (!targetChannel) {
        targetChannel = interaction.guild.channels.cache.find(c => 
          c.name.toLowerCase() === channelInput.toLowerCase() && c.isTextBased()
        );
      }

      if (!targetChannel) {
        return interaction.reply({
          content: `❌ **Error**: Could not resolve channel "${channelInput}". Please select a valid channel from the search results.`,
          ephemeral: true
        });
      }
    }

    const pingOption = interaction.options.getString('ping') || 'none';
    const roleOption = interaction.options.getRole('role');
    const roleOptionId = roleOption ? roleOption.id : 'none';

    // Build the modal to query the announcement message content (preserves whitespace and newlines)
    const modal = new ModalBuilder()
      .setCustomId(`announce_modal_${targetChannel.id}_${pingOption}_${roleOptionId}`)
      .setTitle('📢 Write Announcement');

    const messageInput = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Message Content')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Enter your announcement here (formatting and line breaks are fully preserved)...')
      .setRequired(true)
      .setMaxLength(4000);

    const firstActionRow = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(firstActionRow);

    // Show the modal
    await interaction.showModal(modal);
  },

  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused();
      const channels = await interaction.guild.channels.fetch();
      
      const channelArray = Array.from(channels.values()).filter(c => c && c.isTextBased());
      
      const filtered = channelArray.filter(c => 
        c.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await interaction.respond(
        filtered.slice(0, 25).map(c => ({
          name: `#${c.name}`,
          value: c.id
        }))
      );
    } catch (err) {
      console.error('[Autocomplete Error] Failed to respond in announce:', err);
      await interaction.respond([]).catch(() => {});
    }
  }
};

/**
 * Handles the submission of the announcement modal
 */
export async function handleAnnounceModal(interaction) {
  const parts = interaction.customId.split('_');
  const targetChannelId = parts[2];
  const pingOption = parts[3];
  const roleOptionId = parts[4];

  // Defer reply ephemerally to buy time for sending messages
  await interaction.deferReply({ ephemeral: true });

  try {
    const targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    if (!targetChannel) {
      return interaction.editReply({
        content: `❌ **Error**: Target channel was not found.`
      });
    }

    if (!targetChannel.isTextBased()) {
      return interaction.editReply({
        content: `❌ **Error**: Selected channel <#${targetChannel.id}> is not a text-based channel.`
      });
    }

    // Permission Check: Owner, Admin, Staff, or Sales only
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    let isStaffOrSales = false;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      isStaffOrSales = member.roles.cache.some(role =>
        role.name.toLowerCase() === 'staff' || role.name.toLowerCase() === 'sales'
      );
    } catch (e) {}

    if (!isOwner && !isAdmin && !isStaffOrSales) {
      return interaction.editReply({
        content: '❌ **Permission Denied**: This command is restricted to server Administrators or Staff only.'
      });
    }

    // Retrieve multiline message text from modal
    const message = interaction.fields.getTextInputValue('message');

    // Validate bot permissions in target channel
    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
    const permissions = targetChannel.permissionsFor(botMember);
    
    if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply({
        content: `❌ **Error**: The bot lacks permission to view or send messages in <#${targetChannel.id}>.`
      });
    }

    // Warn if pings are requested but bot lacks permission to mention everyone/roles
    if ((pingOption !== 'none' || roleOptionId !== 'none') && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
      console.warn(`[Bot WARNING] Bot lacks 'Mention Everyone' permission in #${targetChannel.name}. Pings may not notify users.`);
    }

    // Format prefix pings
    let prefix = '';
    if (pingOption === 'everyone') {
      prefix += '@everyone ';
    } else if (pingOption === 'here') {
      prefix += '@here ';
    }
    if (roleOptionId && roleOptionId !== 'none') {
      prefix += `<@&${roleOptionId}> `;
    }

    let fullText = message;
    if (prefix) {
      fullText = `${prefix.trim()}\n${fullText}`;
    }

    // Split message into chunks (max 2000 characters)
    const chunks = splitMessage(fullText, 2000);

    // Send message parts sequentially
    for (const chunk of chunks) {
      await targetChannel.send({
        content: chunk,
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
      });
    }

    // Respond with confirmation embed
    const confirmationEmbed = new EmbedBuilder()
      .setTitle('📢 Announcement Sent')
      .setDescription(`Successfully sent the announcement to <#${targetChannel.id}>.`)
      .setColor('#43B581') // Discord Green
      .addFields(
        { name: 'Target Channel', value: `<#${targetChannel.id}>`, inline: true },
        { name: 'Parts Sent', value: `\`${chunks.length}\``, inline: true },
        { name: 'Pings Added', value: pingOption !== 'none' ? `\`@${pingOption}\`` : roleOptionId !== 'none' ? `<@&${roleOptionId}>` : 'None', inline: true }
      )
      .setFooter({ text: 'Adam Corp Announcement Utility' })
      .setTimestamp();

    await interaction.editReply({ embeds: [confirmationEmbed] });

  } catch (error) {
    console.error('[Bot ERROR] Failed to send announcement from modal:', error);
    await interaction.editReply({
      content: `❌ **Failed to send announcement.**\nError: ${error.message}`
    });
  }
}

/**
 * Splits a text string into chunks of at most maxLength characters,
 * trying to break at line endings where possible.
 */
function splitMessage(text, maxLength = 2000) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // If a single line exceeds the max limit, hard split it
      if (line.length > maxLength) {
        let temp = line;
        while (temp.length > maxLength) {
          chunks.push(temp.slice(0, maxLength));
          temp = temp.slice(maxLength);
        }
        currentChunk = temp;
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
