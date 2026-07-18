import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import db from '../../database/db.js';

export const cancelInvoiceCommand = {
  data: new SlashCommandBuilder()
    .setName('cancel-invoice')
    .setDescription('Clear or delete pending/failed invoices from the system (Staff/Sales only)')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('txn_id')
        .setDescription('Select the specific transaction ID to delete')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('scope')
        .setDescription('Select bulk clearing scope (clears all matching transactions)')
        .setRequired(false)
        .addChoices(
          { name: '🧹 Clear All Failed Invoices', value: 'FAILED' },
          { name: '🧹 Clear All Pending Invoices', value: 'PENDING' }
        )
    ),

  async execute(interaction) {
    // 1. Permission Check: Restrict to "Staff" or "Sales" role (Server Owner & Admins automatically bypass)
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
        content: '❌ **Permission Denied**: This command is restricted to Staff or Sales members only.',
        ephemeral: true
      });
    }

    const txnId = interaction.options.getString('txn_id');
    const scope = interaction.options.getString('scope');

    if (!txnId && !scope) {
      return interaction.reply({
        content: '❌ **Error**: You must select either a specific `txn_id` to delete, or choose a bulk cleanup `scope`.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      // Option A: Specific Transaction deletion
      if (txnId) {
        const transaction = await db.getTransaction(txnId);
        if (!transaction) {
          return interaction.editReply({
            content: `❌ Transaction **\`${txnId}\`** was not found in the system.`
          });
        }

        const success = await db.deleteTransaction(txnId);
        if (success) {
          const embed = new EmbedBuilder()
            .setTitle('🗑️ Invoice Cancelled & Deleted')
            .setDescription(`Successfully removed transaction record from database.`)
            .setColor('#FF0000') // Red
            .addFields(
              { name: 'Transaction ID', value: `\`${txnId}\`` },
              { name: 'Customer', value: `<@${transaction.discord_user_id}>`, inline: true },
              { name: 'Product', value: `\`${transaction.product_name}\``, inline: true },
              { name: 'Amount', value: `\`₹${transaction.amount}.00\``, inline: true },
              { name: 'Deleted By', value: `<@${interaction.user.id}>` }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        } else {
          return interaction.editReply({
            content: `❌ Failed to delete transaction **\`${txnId}\`**.`
          });
        }
      }

      // Option B: Bulk clean by status
      if (scope) {
        const deletedCount = await db.clearTransactionsByStatus(scope);
        const embed = new EmbedBuilder()
          .setTitle('🧹 Invoice Cleanup Complete')
          .setDescription(`Successfully cleared bulk transaction records from the database.`)
          .setColor('#FFA500') // Orange
          .addFields(
            { name: 'Cleanup Target Status', value: `\`${scope}\``, inline: true },
            { name: 'Records Cleared', value: `**${deletedCount} invoices**`, inline: true },
            { name: 'Triggered By', value: `<@${interaction.user.id}>` }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Bot ERROR] Failed to clear transactions:', error.message);
      return interaction.editReply({
        content: `❌ **Failed to clear transactions.**\nError: ${error.message || 'Unknown DB Error'}`
      });
    }
  },

  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused();
      const allTransactions = await db.getTransactions();

      // Show both PENDING and FAILED transactions for deletion
      const deletableTxns = allTransactions.filter(t => t.status === 'PENDING' || t.status === 'FAILED');

      // Map to choice list using local cache synchronously (Zero API calls to prevent 10062)
      const choices = deletableTxns.map(t => {
        let customerName = t.discord_user_name;
        if (!customerName && t.discord_user_id) {
          const cachedUser = interaction.client.users.cache.get(t.discord_user_id);
          if (cachedUser) customerName = cachedUser.username;
        }
        const customerDisplay = customerName ? `${customerName}` : `User(${t.discord_user_id ? t.discord_user_id.substring(t.discord_user_id.length - 4) : 'Unknown'})`;

        let channelName = t.channel_name;
        if (!channelName && t.channel_id) {
          const cachedChannel = interaction.client.channels.cache.get(t.channel_id);
          if (cachedChannel) channelName = cachedChannel.name;
        }
        const channelDisplay = channelName ? `#${channelName}` : `Ticket`;

        const rawName = `[${t.status}] ${customerDisplay} - ${t.product_name} - ₹${t.amount} (${channelDisplay})`;
        const name = rawName.length > 100 ? rawName.substring(0, 97) + '...' : rawName;

        return {
          name,
          value: t.txn_id
        };
      });

      // Filter options
      const filtered = choices.filter(c =>
        c.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
        c.value.toLowerCase().includes(focusedValue.toLowerCase())
      );

      await interaction.respond(filtered.slice(0, 25));
    } catch (err) {
      console.error('[Autocomplete Error] Cancel-invoice autocomplete failed:', err);
      await interaction.respond([]).catch(() => {});
    }
  }
};
