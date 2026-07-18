import express from 'express';
import config from '../config.js';
import db from '../database/db.js';
import { deliverProduct } from '../bot/commands/check-status.js';
import axios from 'axios';

// Format helper to convert ISO string to DD-MM-YYYY
function formatTxnDate(isoString) {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export function startServer(client) {
  const app = express();

  // Support both JSON and URL-encoded webhook payloads
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Debug middleware to log incoming webhook requests
  app.use((req, res, next) => {
    console.log(`[HTTP Request] ${req.method} ${req.path}`);
    next();
  });

  // Webhook listener endpoint
  app.post('/api/payment-webhook', async (req, res) => {
    try {
      console.log('[Webhook RECEIVED] Raw body:', req.body);

      // Extract transaction details
      // UPIGateway webhook payload usually sends: client_txn_id, status (success / failure / true)
      const clientTxnId = req.body.client_txn_id || req.body.clientRefId || req.body.order_id;
      const status = req.body.status; // Can be boolean true, string 'success', 'true', or 'COMPLETED'

      if (!clientTxnId) {
        console.warn('[Webhook WARNING] Missing client_txn_id in webhook payload.');
        return res.status(400).json({ error: 'Missing client_txn_id' });
      }

      // 1. Locate the transaction in the database
      const transaction = await db.getTransaction(clientTxnId);
      if (!transaction) {
        console.warn(`[Webhook WARNING] Transaction with ID "${clientTxnId}" not found in local database.`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Check if already completed to prevent double delivery (idempotency)
      if (transaction.status === 'COMPLETED') {
        console.log(`[Webhook INFO] Transaction "${clientTxnId}" has already been processed.`);
        return res.status(200).json({ status: 'already_processed' });
      }

      // Check if status in webhook is indicating success
      const isSuccessfulStatus = 
        status === true || 
        status === 'true' || 
        status === 'success' || 
        status === 'SUCCESS' || 
        status === 'COMPLETED';

      if (!isSuccessfulStatus) {
        console.log(`[Webhook INFO] Transaction "${clientTxnId}" status is not successful: ${status}`);
        await db.updateTransactionStatus(clientTxnId, 'FAILED');
        return res.status(200).json({ status: 'failed_or_pending' });
      }

      // 2. Secure route: Secondary Verification
      const isMockTest = clientTxnId.includes('99999999999999') || clientTxnId.startsWith('MOCK_');
      if (!config.isSandbox && !isMockTest) {
        // Double-check with UPIGateway check_order_status API to prevent spoofing
        const txnDate = formatTxnDate(transaction.created_at);
        const verifyPayload = {
          key: config.upigateway.key,
          client_txn_id: clientTxnId,
          txn_date: txnDate,
        };

        console.log(`[Webhook Security] Verifying ${clientTxnId} with UPIGateway check_order_status...`);

        try {
          const apiResponse = await axios.post('https://merchant.upigateway.com/api/check_order_status', verifyPayload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          });

          const gatewayStatus = apiResponse.data?.data?.status;
          
          if (!apiResponse.data?.status || (gatewayStatus !== 'COMPLETED' && gatewayStatus !== 'SUCCESS')) {
            console.error(`[Webhook Security FAILED] UPIGateway API did not confirm success. Gateway status: ${gatewayStatus}`);
            return res.status(401).json({ error: 'Verification failed' });
          }
          console.log(`[Webhook Security SUCCESS] UPIGateway API confirmed success for ${clientTxnId}`);
        } catch (apiError) {
          console.error('[Webhook Security ERROR] Failed to contact status verification API:', apiError.message);
          return res.status(500).json({ error: 'Failed to verify transaction authenticity' });
        }
      } else {
        console.log(`[Webhook INFO] Sandbox mode: Bypassing external API verification for ${clientTxnId}`);
      }

      // 3. Update database status to completed
      await db.updateTransactionStatus(clientTxnId, 'COMPLETED');
      console.log(`[DB SUCCESS] Updated status for ${clientTxnId} to COMPLETED`);

      // 4. Trigger delivery (Assign role and DM user)
      await deliverProduct(client, transaction);

      // 5. Send public confirmation to the specific ticket/channel
      if (transaction.channel_id) {
        try {
          const channel = await client.channels.fetch(transaction.channel_id);
          if (channel && channel.isTextBased()) {
            await channel.send({
              content: `✅ **Payment Confirmed!** <@${transaction.discord_user_id}>, your purchase of **${transaction.product_name} (${transaction.tier_or_duration || 'Custom'})** has been processed by staff member <@${transaction.staff_id || ''}>.`
            });
            console.log(`[Webhook Delivery] Channel notification sent to channel ${transaction.channel_id}`);
          }
        } catch (chanErr) {
          console.error(`[Webhook Delivery ERROR] Failed to send confirmation to channel ${transaction.channel_id}:`, chanErr.message);
        }
      }

      // Respond with success to UPIGateway (acknowledge receipt)
      return res.status(200).json({ status: 'success', msg: 'Callback processed successfully' });

    } catch (error) {
      console.error('[Webhook ERROR] Unhandled exception in webhook handler:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Start HTTP Server
  const server = app.listen(config.server.port, () => {
    console.log(`[Server INFO] Express Webhook server listening on port ${config.server.port}`);
  });

  return server;
}
