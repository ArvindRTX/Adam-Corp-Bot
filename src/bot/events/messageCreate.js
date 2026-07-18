import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import db from '../../database/db.js';

// In-memory map to track user message timestamps: userId -> [timestamp1, timestamp2, ...]
const spamTracker = new Map();

export default {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Ignore bots, system messages, and direct messages (DMs)
      if (message.author.bot || !message.guild) return;

      // Fetch config
      const config = await db.getAntiRaidConfig();
      if (!config.enabled) return;

      // Exempt Server Owner, Admins, and Staff/Sales roles from auto-moderation
      const isOwner = message.guild.ownerId === message.author.id;
      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
      let isStaff = false;
      try {
        isStaff = message.member?.roles.cache.some(role =>
          role.name.toLowerCase() === 'staff' || role.name.toLowerCase() === 'sales'
        );
      } catch (e) {}

      if (isOwner || isAdmin || isStaff) return;

      const now = Date.now();
      const alertChannel = config.alertChannelId ? await message.guild.channels.fetch(config.alertChannelId).catch(() => null) : null;

      // 1. Anti-Link / Anti-Invite checks
      if (config.blockLinks) {
        const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord(app)?\.com\/invite\/.+)/i;
        const genericUrlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

        if (inviteRegex.test(message.content) || genericUrlRegex.test(message.content)) {
          await message.delete().catch(() => {});
          
          const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}>, posting links/invites is not allowed here.`);
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

          if (alertChannel && alertChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('🛡️ Anti-Link Triggered')
              .setColor('#FFA500')
              .addFields(
                { name: 'User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Content Preview', value: `\`\`\`${message.content.substring(0, 500)}\`\`\`` }
              )
              .setTimestamp();
            await alertChannel.send({ embeds: [embed] });
          }
          return; // Stop further checks as the message is already deleted
        }
      }

      // 2. Anti-Mention-Spam check
      const userMentions = message.mentions.users.size;
      const roleMentions = message.mentions.roles.size;
      const totalMentions = userMentions + roleMentions + (message.mentions.everyone ? 1 : 0);

      if (totalMentions > config.maxMentions) {
        await message.delete().catch(() => {});
        
        // Timeout member for 10 minutes
        await message.member.timeout(10 * 60 * 1000, 'Anti-Raid: Mention Spam').catch(() => {});
        
        const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}> has been timed out for 10 minutes due to excessive mentions.`);
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Mention Spam Detected')
            .setColor('#FF0000')
            .addFields(
              { name: 'User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
              { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
              { name: 'Mentions Count', value: `\`${totalMentions}\``, inline: true },
              { name: 'Action Taken', value: 'Message deleted & user timed out for 10 minutes.' }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
        return; // Stop further checks
      }

      // 3. Anti-Spam check (message rate limit)
      let userSpamTimes = spamTracker.get(message.author.id) || [];
      userSpamTimes.push(now);

      const spamWindowStart = now - (config.spamWindowSeconds * 1000);
      userSpamTimes = userSpamTimes.filter(t => t > spamWindowStart);
      spamTracker.set(message.author.id, userSpamTimes);

      if (userSpamTimes.length > config.spamLimit) {
        // Delete current message
        await message.delete().catch(() => {});

        // Delete recent messages from this user in this channel
        const fetchedMessages = await message.channel.messages.fetch({ limit: 30 }).catch(() => null);
        if (fetchedMessages) {
          const userSpamMsgs = fetchedMessages.filter(m => 
            m.author.id === message.author.id && 
            m.createdTimestamp > spamWindowStart
          );
          if (userSpamMsgs.size > 0) {
            await message.channel.bulkDelete(userSpamMsgs).catch(() => {});
          }
        }

        // Timeout member for 10 minutes
        await message.member.timeout(10 * 60 * 1000, 'Anti-Raid: Chat Spamming').catch(() => {});

        const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}> has been timed out for 10 minutes due to message spamming.`);
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

        if (alertChannel && alertChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Chat Spam Detected')
            .setColor('#FF0000')
            .addFields(
              { name: 'User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
              { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
              { name: 'Action Taken', value: 'Spam messages deleted & user timed out for 10 minutes.' }
            )
            .setTimestamp();
          await alertChannel.send({ embeds: [embed] });
        }
      }
    } catch (err) {
      console.error('[messageCreate Event Error]', err);
    }
  }
};
