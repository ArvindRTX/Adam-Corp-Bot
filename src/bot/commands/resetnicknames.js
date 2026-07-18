import { SlashCommandBuilder, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from 'discord.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateProgressBar = (current, total, size = 15) => {
  const percent = Math.min(Math.max((current / total), 0), 1);
  const progress = Math.round(size * percent);
  const emptyProgress = size - progress;
  const progressText = '█'.repeat(progress);
  const emptyProgressText = '░'.repeat(emptyProgress);
  const percentage = Math.round(percent * 100);
  return `\`[${progressText}${emptyProgressText}]\` **${percentage}%** (${current}/${total})`;
};

export const resetnicknamesCommand = {
  data: new SlashCommandBuilder()
    .setName('resetnicknames')
    .setDescription('Reset all human member nicknames back to their default usernames')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    // 1. Permission Check
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ **Permission Denied**: You must have the `Manage Nicknames` permission to run this command.',
        ephemeral: true
      });
    }

    // 2. Initial Feedback
    await interaction.reply({
      content: '🔄 **Process Started**: Fetching members and resetting nicknames to default...'
    });

    try {
      // 3. Fetch all members
      const members = await interaction.guild.members.fetch();

      // 4. Filter target members:
      // - Exclude bots
      // - Exclude server owner
      // - Include only members who have a custom nickname (i.e. nickname is not null)
      const targets = members.filter(member => {
        if (member.user.bot) return false;
        if (member.id === interaction.guild.ownerId) return false;
        if (!member.nickname) return false;
        return true;
      });

      if (targets.size === 0) {
        return interaction.editReply({
          content: '✅ **Completed**: No members have custom nicknames set.'
        });
      }

      let successCount = 0;
      let processedCount = 0;

      // 5. Update nickname for each target member (reset to null)
      for (const [memberId, member] of targets) {
        try {
          await member.setNickname(null);
          successCount++;
        } catch (error) {
          // Silently ignore hierarchy/permissions and other setNickname errors
          console.warn(`[resetnicknames] Failed to reset nickname for ${member.user.tag}:`, error.message);
        }

        processedCount++;
        const progressBarText = generateProgressBar(processedCount, targets.size);
        await interaction.editReply({
          content: `🔄 **Process in Progress**: Resetting nicknames...\n\n${progressBarText}\n*(Status: **${successCount}** successfully updated)*`
        }).catch(() => {});

        // Delay between updates (1500ms) to respect rate limits
        await sleep(1500);
      }

      // 6. Final Feedback
      await interaction.editReply({
        content: `✅ **Completed**: Nicknames reset successfully for **${successCount}** of **${targets.size}** eligible member(s).`
      });

    } catch (err) {
      console.error('[resetnicknames Command ERROR]', err);
      await interaction.editReply({
        content: `❌ **An error occurred during execution**: ${err.message}`
      }).catch(() => {});
    }
  }
};
