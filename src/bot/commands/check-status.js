import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import axios from 'axios';
import config, { hasAllowedRole } from '../../config.js';
import db from '../../database/db.js';

// Format helper to convert ISO string to DD-MM-YYYY
function formatTxnDate(isoString) {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export const checkStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('check-status')
    .setDescription('Query the status of an invoice payment transaction')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('txn_id')
        .setDescription('Select or enter the transaction ID')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    const txnId = interaction.options.getString('txn_id');

    // Defer reply publicly for slash command
    await interaction.deferReply({ ephemeral: false });

    // Call the shared verification handler
    await handleStatusVerification(interaction, txnId, false);
  },

  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused();
      const pendingTransactions = await db.getPendingTransactions();

      // Check if user has Staff/Sales/Admin roles to determine filter scope
      let isStaffOrSales = false;
      try {
        const member = await interaction.guild?.members.fetch(interaction.user.id);
        isStaffOrSales = hasAllowedRole(member) || interaction.guild?.ownerId === interaction.user.id || member?.permissions.has(PermissionFlagsBits.Administrator);
      } catch (e) {
        console.error('[Autocomplete Check Error] Failed to fetch member permissions:', e.message);
      }

      // Filter transactions: staff can see all pending, normal users see their own
      let userTxns = pendingTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (!isStaffOrSales) {
        userTxns = userTxns.filter(t => t.discord_user_id === interaction.user.id);
      }

      // Map to choices synchronously using cache only (Zero API calls during autocomplete)
      const choices = userTxns.map(t => {
        let customerName = t.discord_user_name;
        if (!customerName && t.discord_user_id) {
          const cachedUser = interaction.client.users.cache.get(t.discord_user_id);
          if (cachedUser) {
            customerName = cachedUser.username;
          }
        }
        const customerDisplay = customerName ? `${customerName}` : `User(${t.discord_user_id ? t.discord_user_id.substring(t.discord_user_id.length - 4) : 'Unknown'})`;

        let channelName = t.channel_name;
        if (!channelName && t.channel_id) {
          const cachedChannel = interaction.client.channels.cache.get(t.channel_id);
          if (cachedChannel) {
            channelName = cachedChannel.name;
          }
        }
        const channelDisplay = channelName ? `#${channelName}` : `Ticket`;

        const rawName = `${customerDisplay} - ${t.product_name} (${t.tier_or_duration || 'Custom'}) - ₹${t.amount} (${channelDisplay})`;
        const name = rawName.length > 100 ? rawName.substring(0, 97) + '...' : rawName;
        
        return {
          name,
          value: t.txn_id
        };
      });

      // Filter based on focused autocomplete input search
      const filtered = choices.filter(c =>
        c.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
        c.value.toLowerCase().includes(focusedValue.toLowerCase())
      );

      // Respond with choices
      await interaction.respond(filtered.slice(0, 25));
    } catch (err) {
      console.error('[Autocomplete Error] Status autocomplete failed:', err);
      await interaction.respond([]).catch(() => {});
    }
  }
};

// Shared payment verification handler (for slash commands and invoice buttons)
export async function handleStatusVerification(interaction, txnId, isButton = false) {
  try {
    const transaction = await db.getTransaction(txnId);

    if (!transaction) {
      const errMsg = `❌ Transaction **\`${txnId}\`** was not found in the system.`;
      if (isButton) {
        return interaction.reply({ content: errMsg, ephemeral: false });
      } else {
        return interaction.editReply({ content: errMsg });
      }
    }

    // 1. If transaction is already COMPLETED
    if (transaction.status === 'COMPLETED') {
      if (isButton) {
        // Clean up components on invoice card if they haven't been removed yet
        try {
          const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#00FF00')
            .setDescription('✅ **This invoice has been paid and completed.**');
          await interaction.message.edit({ embeds: [originalEmbed], components: [] });
        } catch (e) {
          console.error('[Button Edit Error]', e.message);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Payment Status: COMPLETED')
        .setDescription(`Transaction **\`${txnId}\`** is successfully completed.`)
        .setColor('#00FF00')
        .addFields(
          { name: '👤 Customer', value: `<@${transaction.discord_user_id}>`, inline: true },
          { name: '📦 Product', value: `\`${transaction.product_name}\``, inline: true },
          { name: '🏷️ Tier', value: `\`${transaction.tier_or_duration || 'Custom'}\``, inline: true },
          { name: '💵 Amount', value: `\`₹${transaction.amount}.00\``, inline: true },
          { name: 'Completed At', value: `\`${transaction.updated_at || transaction.created_at}\`` }
        )
        .setTimestamp();

      if (isButton) {
        return interaction.reply({ embeds: [embed], ephemeral: false });
      } else {
        return interaction.editReply({ embeds: [embed] });
      }
    }

    // 2. If transaction is PENDING
    if (transaction.status === 'PENDING') {
      let isPaymentSuccess = false;
      let gatewayStatus = 'PENDING';

      if (config.isSandbox) {
        // SANDBOX MODE: Allow Staff/Owner/Admins to bypass and force-complete payment for testing
        let isStaff = false;
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          isStaff = hasAllowedRole(member) || interaction.guild.ownerId === interaction.user.id || member.permissions.has(PermissionFlagsBits.Administrator);
        } catch (e) {}

        if (isStaff) {
          isPaymentSuccess = true;
          gatewayStatus = 'COMPLETED (Sandbox Staff Bypass)';
          console.log(`[Sandbox Force] Staff member ${interaction.user.tag} forced completion for txn: ${txnId}`);
        }
      } else {
        // Query UPIGateway API
        const txnDate = formatTxnDate(transaction.created_at);
        const payload = {
          key: config.upigateway.key,
          client_txn_id: txnId,
          txn_date: txnDate,
        };

        console.log(`[Status Check] Querying UPIGateway for ${txnId} (Date: ${txnDate})`);

        const response = await axios.post('https://merchant.upigateway.com/api/check_order_status', payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });

        if (response.data && response.data.status === true) {
          gatewayStatus = response.data.data?.status;
          if (gatewayStatus === 'COMPLETED' || gatewayStatus === 'SUCCESS') {
            isPaymentSuccess = true;
          }
        }
      }

      if (isPaymentSuccess) {
        // Update database log
        await db.updateTransactionStatus(txnId, 'COMPLETED');
        console.log(`[DB SUCCESS] Status updated to COMPLETED via manual check for ${txnId}`);

        // Trigger DM delivery & Role assignment
        await deliverProduct(interaction.client, transaction);

        // Edit original invoice embed to clear payment buttons
        if (isButton) {
          try {
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
              .setColor('#00FF00')
              .setDescription('✅ **This invoice has been paid and completed.**');
            await interaction.message.edit({ embeds: [originalEmbed], components: [] });
          } catch (e) {
            console.error('[Button Edit Error]', e.message);
          }
        }

        // Send confirmation message to purchase channel/ticket
        if (transaction.channel_id) {
          try {
            const channel = await interaction.client.channels.fetch(transaction.channel_id);
            if (channel && channel.isTextBased()) {
              await channel.send({
                content: `✅ **Payment Confirmed!** <@${transaction.discord_user_id}>, your purchase of **${transaction.product_name} (${transaction.tier_or_duration || 'Custom'})** has been processed by staff member <@${transaction.staff_id || ''}>.`
              });
            }
          } catch (chanErr) {
            console.error('[Channel Notify Error]', chanErr.message);
          }
        }

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Payment Confirmed & Delivered')
          .setDescription(`Successfully confirmed payment for transaction **\`${txnId}\`**.`)
          .setColor('#00FF00')
          .addFields(
            { name: '👤 Customer', value: `<@${transaction.discord_user_id}>`, inline: true },
            { name: '📦 Product', value: `\`${transaction.product_name}\``, inline: true },
            { name: '💵 Amount Paid', value: `\`₹${transaction.amount}.00\``, inline: true }
          )
          .setTimestamp();

        if (isButton) {
          return interaction.reply({ embeds: [successEmbed], ephemeral: false });
        } else {
          return interaction.editReply({ embeds: [successEmbed] });
        }
      } else {
        // Still pending - construct identical public rich embed
        const embed = new EmbedBuilder()
          .setTitle('⏳ Payment Status: PENDING')
          .setDescription(`Transaction **\`${txnId}\`** is still waiting for payment.`)
          .setColor('#FFA500')
          .addFields(
            { name: '👤 Customer', value: `<@${transaction.discord_user_id}>`, inline: true },
            { name: 'Gateway Status', value: `\`${gatewayStatus || 'PENDING'}\``, inline: true },
            { name: 'Action', value: 'Please scan the QR code and pay. If already paid, wait 1-2 minutes and click Check Status again.' }
          )
          .setTimestamp();

        if (isButton) {
          return interaction.reply({ embeds: [embed], ephemeral: false });
        } else {
          return interaction.editReply({ embeds: [embed] });
        }
      }
    }

    // 3. FAILED status
    const failEmbed = new EmbedBuilder()
      .setTitle('❌ Payment Status: FAILED')
      .setDescription(`Transaction **\`${txnId}\`** status is marked as \`${transaction.status}\`.`)
      .setColor('#FF0000')
      .setTimestamp();

    if (isButton) {
      return interaction.reply({ embeds: [failEmbed], ephemeral: false });
    } else {
      return interaction.editReply({ embeds: [failEmbed] });
    }

  } catch (error) {
    console.error(`[Status Error] Failed to handle status check for ${txnId}:`, error.message);
    const errMsg = `❌ **Failed to verify status.**\nError: ${error.message || 'Unknown Gateway Error'}`;
    if (isButton) {
      return interaction.reply({ content: errMsg, ephemeral: false });
    } else {
      return interaction.editReply({ content: errMsg });
    }
  }
}

// Delivery helper function (exported for Express webhook)
export async function deliverProduct(client, transaction) {
  const { discord_user_id, product_name, tier_or_duration, amount } = transaction;

  // 1. Send Direct Message to User
  try {
    const user = await client.users.fetch(discord_user_id);
    const dmEmbed = new EmbedBuilder()
      .setTitle('📦 Adam Corp - Product Delivered!')
      .setDescription(`Thank you for your purchase of **${product_name}**!`)
      .setColor('#00FF00')
      .addFields(
        { name: 'Product', value: `\`${product_name}\``, inline: true },
        { name: 'Tier/Duration', value: `\`${tier_or_duration || 'Custom'}\``, inline: true },
        { name: 'Amount Paid', value: `\`₹${amount}.00\``, inline: true },
        { name: 'Delivery Instructions', value: `Your product key/access file has been generated. Please follow the instructions below:\n\n🔑 **Key/Link:** [Download Panel / Get Keys](https://adamcorp.com/downloads/${product_name.toLowerCase().replace(/ /g, '-')})\n\nNeed help? Join the support channel on our server.` }
      )
      .setTimestamp();

    await user.send({ embeds: [dmEmbed] });
    console.log(`[Delivery] Successfully sent product DM to customer ${user.tag} (${discord_user_id})`);
  } catch (error) {
    console.error(`[Delivery ERROR] Failed to send DM to customer ${discord_user_id}:`, error.message);
  }

  // 2. Grant Discord Role in Guild
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    if (!guild) throw new Error('Guild not found');

    const member = await guild.members.fetch(discord_user_id);
    if (!member) throw new Error('Member not found in guild');

    // Find role by ID or Name
    let role = null;
    if (config.discord.roleId) {
      role = await guild.roles.fetch(config.discord.roleId);
    } else {
      role = guild.roles.cache.find(r => r.name.toLowerCase() === config.discord.roleName.toLowerCase());
    }

    if (!role) {
      console.warn(`[Delivery WARNING] Role "${config.discord.roleName}" not found in guild. Attempting to create it...`);
      role = await guild.roles.create({
        name: config.discord.roleName,
        color: '#5865F2',
        reason: 'Automated UPI Delivery Role',
      });
      console.log(`[Delivery] Role "${config.discord.roleName}" created.`);
    }

    await member.roles.add(role);
    console.log(`[Delivery] Role "${role.name}" successfully added to user ${member.user.tag}`);
  } catch (error) {
    console.error(`[Delivery ERROR] Failed to assign role to user ${discord_user_id}:`, error.message);
  }
}
