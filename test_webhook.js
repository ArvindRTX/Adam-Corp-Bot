import axios from 'axios';
import fs from 'fs/promises';

const DB_FILE = './database.json';
const WEBHOOK_URL = 'http://localhost:3000/api/payment-webhook';

async function runTest() {
  console.log('--- Starting Staff-Driven UPI Webhook Test Simulator ---');
  
  // 1. Create a mock sales invoice transaction in the DB
  const mockTxnId = `ADAM_INV_${Date.now()}_99999999999999`;
  const mockTransaction = {
    txn_id: mockTxnId,
    discord_user_id: '123456789012345678', // Target Customer ID
    staff_id: '987654321098765432',       // Staff Member ID who issued invoice
    channel_id: '112233445566778899',     // Ticket/Purchase Channel ID
    product_name: 'Silent Aim Max',
    tier_or_duration: 'Monthly',
    amount: 999,
    status: 'PENDING',
    created_at: new Date().toISOString()
  };

  try {
    let dbData = { transactions: [] };
    try {
      const content = await fs.readFile(DB_FILE, 'utf-8');
      dbData = JSON.parse(content);
    } catch (e) {
      console.log('Database file not found, initializing...');
    }

    dbData.transactions.push(mockTransaction);
    await fs.writeFile(DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');
    console.log(`[Test] Created mock PENDING sales transaction: ${mockTxnId}`);

    // 2. Fire POST request to our Express webhook server
    const payload = {
      client_txn_id: mockTxnId,
      status: true
    };

    console.log(`[Test] Sending POST request to ${WEBHOOK_URL}...`);
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('[Test] Webhook response received status:', response.status);
    console.log('[Test] Webhook response body:', response.data);

    // 3. Verify status in database
    const finalContent = await fs.readFile(DB_FILE, 'utf-8');
    const finalDb = JSON.parse(finalContent);
    const updatedTxn = finalDb.transactions.find(t => t.txn_id === mockTxnId);
    
    console.log(`[Test] Transaction database status post-webhook: ${updatedTxn?.status}`);
    if (updatedTxn?.status === 'COMPLETED') {
      console.log('✅ TEST PASSED: Webhook processed successfully, database status updated to COMPLETED.');
    } else {
      console.log('❌ TEST FAILED: Transaction status is not COMPLETED.');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

runTest();
