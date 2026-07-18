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

export const addprefixCommand = {
  data: new SlashCommandBuilder()
    .setName('addprefix')
    .setDescription('Add a prefix to all human member nicknames in the server')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('prefix')
        .setDescription('The prefix string to add (e.g., [Member])')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    // 1. Permission Check
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ **Permission Denied**: You must have the `Manage Nicknames` permission to run this command.',
        ephemeral: true
      });
    }

    const prefixInput = interaction.options.getString('prefix');
    // Ensure trailing space is added
    const prefix = prefixInput.endsWith(' ') ? prefixInput : `${prefixInput} `;

    // 2. Initial Feedback
    await interaction.reply({
      content: `🔄 **Process Started**: Fetching members and beginning nickname updates with prefix \`${prefix}\`...`
    });

    try {
      // 3. Fetch all members
      const members = await interaction.guild.members.fetch();

      // 4. Filter target members:
      // - Exclude bots
      // - Exclude server owner
      // - Exclude members whose display name already starts with the prefix
      const targets = members.filter(member => {
        if (member.user.bot) return false;
        if (member.id === interaction.guild.ownerId) return false;
        if (member.displayName.startsWith(prefix)) return false;
        return true;
      });

      if (targets.size === 0) {
        return interaction.editReply({
          content: `✅ **Completed**: No matching members found to update (all eligible members already have the prefix \`${prefix}\` or there are no other human members).`
        });
      }

      let successCount = 0;
      let processedCount = 0;

      // 5. Update nickname for each target member
      for (const [memberId, member] of targets) {
        try {
          const finalNickname = `${prefix}${member.displayName}`.slice(0, 32);
          await member.setNickname(finalNickname);
          successCount++;
        } catch (error) {
          // Silently ignore hierarchy/permissions and other setNickname errors
          console.warn(`[addprefix] Failed to update nickname for ${member.user.tag}:`, error.message);
        }

        processedCount++;
        const progressBarText = generateProgressBar(processedCount, targets.size);
        await interaction.editReply({
          content: `🔄 **Process in Progress**: Updating nicknames...\n\n${progressBarText}\n*(Status: **${successCount}** successfully updated)*`
        }).catch(() => {});

        // Delay between updates (1500ms) to respect rate limits
        await sleep(1500);
      }

      // 6. Final Feedback
      await interaction.editReply({
        content: `✅ **Completed**: Nicknames updated successfully for **${successCount}** of **${targets.size}** eligible human member(s).`
      });

    } catch (err) {
      console.error('[addprefix Command ERROR]', err);
      await interaction.editReply({
        content: `❌ **An error occurred during execution**: ${err.message}`
      }).catch(() => {});
    }
  }
};
