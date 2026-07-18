import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import axios from 'axios';
import config, { hasAllowedRole } from '../../config.js';
import db from '../../database/db.js';

export const invoiceCommand = {
  data: new SlashCommandBuilder()
    .setName('invoice')
    .setDescription('Generate a payment invoice for a customer (Staff/Sales only)')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Select the target customer')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('product')
        .setDescription('Select the product')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('tier_or_duration')
        .setDescription('Select the product tier / duration')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('custom_price')
        .setDescription('Enter custom price in INR (Only applicable for Custom Amount product)')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction) {
    // 1. Permission Check: Restrict to authorized roles (Server Owner & Admins automatically bypass)
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    let isStaffOrSales = false;
    try {
      // Fetch member directly to bypass caching issues (needed when GuildMembers intent is disabled)
      const member = await interaction.guild.members.fetch(interaction.user.id);
      isStaffOrSales = hasAllowedRole(member);
    } catch (fetchErr) {
      console.error('[Permission Check ERROR] Failed to fetch member roles:', fetchErr.message);
    }

    if (!isOwner && !isAdmin && !isStaffOrSales) {
      return interaction.reply({
        content: '❌ **Permission Denied**: This command is restricted to members with authorized roles only.',
        ephemeral: true
      });
    }

    const customer = interaction.options.getUser('user');
    const product = interaction.options.getString('product');
    const tier = interaction.options.getString('tier_or_duration');
    const customPrice = interaction.options.getInteger('custom_price');

    // 2. Validate Catalog and Pricing Options
    let finalAmount = 0;
    let finalTier = tier || 'Custom';

    if (product === 'Custom Amount') {
      if (!customPrice) {
        return interaction.reply({
          content: '❌ **Error**: You must specify `custom_price` when selecting **Custom Amount**.',
          ephemeral: true
        });
      }
      finalAmount = customPrice;
      finalTier = 'Custom';
    } else {
      const productPricing = config.products[product];
      if (!tier) {
        const availableTiers = Object.keys(productPricing).join(', ');
        return interaction.reply({
          content: `❌ **Error**: Please select a valid \`tier_or_duration\` option for **${product}**. (Available: ${availableTiers})`,
          ephemeral: true
        });
      }

      finalAmount = productPricing[tier];
      if (finalAmount === undefined) {
        const availableTiers = Object.keys(productPricing).join(', ');
        return interaction.reply({
          content: `❌ **Error**: Tier \`${tier}\` is not valid for **${product}**. Please choose from: ${availableTiers}`,
          ephemeral: true
        });
      }
    }

    // 3. Generate tracking transaction ID
    const timestamp = Date.now();
    // Unique ID combining timestamps, customer, staff and channel IDs for complete safety
    const txnId = `ADAM_INV_${timestamp}_${customer.id}`;

    // Defer the reply publicly (ephemeral: false)
    await interaction.deferReply({ ephemeral: false });

    try {
      await db.createTransaction({
        txn_id: txnId,
        discord_user_id: customer.id,
        discord_user_name: customer.username,
        staff_id: interaction.user.id,
        channel_id: interaction.channelId,
        channel_name: interaction.channel.name || 'Ticket',
        product_name: product,
        tier_or_duration: finalTier,
        amount: finalAmount,
        status: 'PENDING'
      });

      let paymentUrl = '';

      if (config.isSandbox) {
        // Mock payment URL
        paymentUrl = `https://merchant.upigateway.com/gateway/pay/mock_${txnId}`;
        console.log(`[Sandbox INFO] Generated mock invoice payment URL: ${paymentUrl}`);
      } else {
        // Call UPIGateway api/create_order
        const payload = {
          key: config.upigateway.key,
          client_txn_id: txnId,
          amount: finalAmount.toString(),
          p_info: `${product} - ${finalTier}`,
          customer_name: customer.username,
          customer_email: 'dummy@adamcorp.com',
          customer_mobile: '9999999999',
          redirect_url: config.upigateway.webhookUrl,
        };

        console.log(`[UPIGateway Request] Creating invoice ${txnId} for ${customer.tag}. Amount: ₹${finalAmount}`);

        const response = await axios.post('https://merchant.upigateway.com/api/create_order', payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });

        if (response.data && response.data.status === true) {
          paymentUrl = response.data.data.payment_url;
        } else {
          console.error('[UPIGateway Error] API responded with error:', response.data);
          throw new Error(response.data?.msg || response.data?.message || 'Failed to create payment link');
        }
      }

      // 5. Build highly styled public Discord Embed
      const embed = new EmbedBuilder()
        .setTitle('🧾 Adam Corp - Payment Invoice')
        .setDescription('A payment link has been generated. The customer must click the link to scan the UPI QR code and complete their purchase.')
        .setColor('#5865F2') // Blurple
        .addFields(
          { name: '👤 Customer', value: `<@${customer.id}>`, inline: true },
          { name: '💼 Staff Member', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📦 Product', value: `\`${product}\``, inline: true },
          { name: '🏷️ Tier / Duration', value: `\`${finalTier}\``, inline: true },
          { name: '💵 Amount Due', value: `**₹${finalAmount}.00 INR**`, inline: true },
          { name: '🔢 Transaction ID', value: `\`${txnId}\`` },
          { name: 'ℹ️ Instructions', value: '1. Click the payment link button below.\n2. Complete the payment via **GPay, PhonePe, Paytm**, or any UPI application.\n3. Upon success, this channel will confirm the order automatically.' }
        )
        .setFooter({ text: 'Adam Corp Automated Sales Terminal' })
        .setTimestamp();

      const payButton = new ButtonBuilder()
        .setLabel('🔗 Pay via GPay / PhonePe / Paytm')
        .setURL(paymentUrl)
        .setStyle(ButtonStyle.Link);

      const checkButton = new ButtonBuilder()
        .setCustomId(`check_status_${txnId}`)
        .setLabel('🔄 Check Status')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(payButton, checkButton);

      // Reply publicly
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

    } catch (error) {
      console.error(`[Bot ERROR] Failed to generate invoice for customer ${customer.tag}:`, error.message);
      
      // Update local db transaction status if failed to initiate
      await db.updateTransactionStatus(txnId, 'FAILED').catch(e => console.error('[Bot ERROR] Failed to update DB on fail:', e.message));

      await interaction.editReply({
        content: `❌ **Failed to generate invoice.**\nError: ${error.message || 'Unknown Gateway Error'}`
      });
    }
  },

  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused();
      const product = interaction.options.getString('product');

      if (!product) {
        return interaction.respond([]);
      }

      const productPricing = config.products[product];
      if (!productPricing) {
        return interaction.respond([]);
      }

      // Extract the tier keys (e.g. ['7 Days', '14 Days', ...])
      const choices = Object.keys(productPricing);
      const filtered = choices.filter(choice =>
        choice.toLowerCase().includes(focusedValue.toLowerCase())
      );

      // Map to Discord API choice objects (max 25 allowed)
      await interaction.respond(
        filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))
      );
    } catch (err) {
      console.error('[Autocomplete ERROR] Failed to respond to autocomplete interaction:', err);
      // Suppress crash by responding with empty array
      await interaction.respond([]).catch(() => {});
    }
  }
};
