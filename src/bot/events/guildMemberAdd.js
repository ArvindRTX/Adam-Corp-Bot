import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import db from '../../database/db.js';

// In-memory array to track recent join timestamps
const joinTracker = [];

export default {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      const config = await db.getAntiRaidConfig();

      if (config.enabled) {
        const now = Date.now();
        const alertChannel = config.alertChannelId ? await member.guild.channels.fetch(config.alertChannelId).catch(() => null) : null;

        // 1. Account Age Check
        const accountAgeMs = now - member.user.createdTimestamp;
        const minAgeMs = config.minAccountAgeHours * 60 * 60 * 1000;

        if (accountAgeMs < minAgeMs) {
          const ageHours = Math.round(accountAgeMs / (60 * 60 * 1000));
          
          // Attempt to DM the user
          await member.send({
            content: `❌ **Access Denied**: Your account is too new to join **${member.guild.name}**. Minimum age required is **${config.minAccountAgeHours} hours** (your account age is **${ageHours} hours**).`
          }).catch(() => {});

          // Kick the member
          await member.kick('Anti-Raid: Account age below threshold');

          // Log the action to the alert channel
          if (alertChannel && alertChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('🛡️ Anti-Raid Alert: New Account Kicked')
              .setColor('#FF0000')
              .addFields(
                { name: 'User', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
                { name: 'Account Age', value: `\`${ageHours} hours\``, inline: true },
                { name: 'Threshold Required', value: `\`${config.minAccountAgeHours} hours\``, inline: true }
              )
              .setTimestamp();
            await alertChannel.send({ embeds: [embed] });
          }
          return;
        }

        // 2. Lockdown Mode Check
        if (config.lockdown) {
          // Attempt to DM the user
          await member.send({
            content: `❌ **Access Denied**: **${member.guild.name}** is currently in lockdown mode due to a suspected raid. Please try again later.`
          }).catch(() => {});

          // Kick the member
          await member.kick('Anti-Raid: Server Lockdown active');

          // Log the action to the alert channel
          if (alertChannel && alertChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('🔒 Lockdown Alert: User Kicked')
              .setDescription(`Auto-kicked user **${member.user.tag}** because server lockdown is active.`)
              .setColor('#FFA500')
              .setTimestamp();
            await alertChannel.send({ embeds: [embed] });
          }
          return;
        }

        // 3. Join Rate Limit Check
        joinTracker.push(now);

        // Filter tracker array to remove timestamps outside our window
        const windowStart = now - (config.joinWindowSeconds * 1000);
        while (joinTracker.length > 0 && joinTracker[0] < windowStart) {
          joinTracker.shift();
        }

        if (joinTracker.length > config.joinLimit) {
          // Auto-trigger Lockdown in DB
          await db.updateAntiRaidConfig({ lockdown: true });

          // Alert administrators in the log channel
          if (alertChannel && alertChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('🚨 EMERGENCY LOCKDOWN TRIGGERED 🚨')
              .setDescription(`Suspected join raid detected! More than **${config.joinLimit} users** joined in **${config.joinWindowSeconds} seconds**.`)
              .setColor('#FF0000')
              .addFields(
                { name: 'Raid Indicator', value: `\`${joinTracker.length} joins\` detected in the current window.` },
                { name: 'Action Taken', value: 'Enabled automatic join lockdown. All subsequent joins will be kicked automatically.' }
              )
              .setTimestamp();

            await alertChannel.send({ 
              content: '⚠️ **Attention Administrators!** suspected raid in progress.',
              embeds: [embed] 
            });
          }

          // Kick this user too as part of the lockdown start
          await member.send({
            content: `❌ **Access Denied**: **${member.guild.name}** has entered lockdown mode due to a suspected raid. Please try again later.`
          }).catch(() => {});
          await member.kick('Anti-Raid: Join flood threshold exceeded');
          return;
        }
      }

      // 4. Automatically set the nickname prefix for successfully joined members
      const prefix = "ᴬᴰᴬᴹ 〆 ";
      const originalName = member.user.displayName || member.user.username;
      const finalNickname = `${prefix}${originalName}`.slice(0, 32);

      try {
        await member.setNickname(finalNickname);
        console.log(`[guildMemberAdd] Automatically set nickname prefix for joining member: ${member.user.tag}`);
      } catch (error) {
        console.warn(`[guildMemberAdd] Failed to set nickname prefix for ${member.user.tag}:`, error.message);
      }
    } catch (err) {
      console.error('[guildMemberAdd Event Error]', err);
    }
  }
};
