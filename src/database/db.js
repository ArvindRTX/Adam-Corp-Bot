import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = process.env.DATABASE_PATH || path.join(__dirname, '../../database.json');

class JSONDatabase {
  constructor() {
    this.data = { transactions: [], antiraid: null };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      // Ensure the directory exists
      await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
      
      // Try to read the database file
      try {
        const content = await fs.readFile(DB_FILE, 'utf-8');
        this.data = JSON.parse(content);
        if (!this.data.transactions) {
          this.data.transactions = [];
        }
        if (!this.data.antiraid) {
          this.data.antiraid = {
            enabled: true,
            lockdown: false,
            minAccountAgeHours: 24,
            joinLimit: 5,
            joinWindowSeconds: 10,
            spamLimit: 5,
            spamWindowSeconds: 3,
            maxMentions: 4,
            blockLinks: true,
            alertChannelId: null
          };
        }
      } catch (err) {
        // If file doesn't exist, create it with default structure
        if (err.code === 'ENOENT') {
          await this.save();
        } else {
          throw err;
        }
      }
      this.initialized = true;
      console.log(`[DB INFO] Database initialized at ${DB_FILE}`);
    } catch (err) {
      console.error('[DB ERROR] Failed to initialize database:', err);
      throw err;
    }
  }

  async save() {
    try {
      await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB ERROR] Failed to save database:', err);
      throw err;
    }
  }

  async load() {
    try {
      const content = await fs.readFile(DB_FILE, 'utf-8');
      this.data = JSON.parse(content);
      if (!this.data.transactions) {
        this.data.transactions = [];
      }
    } catch (err) {
      // If file doesn't exist, we'll keep the current state or initialize it
      if (err.code === 'ENOENT') {
        await this.save();
      } else {
        console.error('[DB ERROR] Failed to reload database:', err);
      }
    }
  }

  async createTransaction(transaction) {
    await this.init();
    await this.load(); // Load latest from disk
    const newTxn = {
      txn_id: transaction.txn_id,
      discord_user_id: transaction.discord_user_id,
      product_name: transaction.product_name,
      amount: transaction.amount,
      status: transaction.status || 'PENDING',
      created_at: new Date().toISOString(),
    };
    this.data.transactions.push(newTxn);
    await this.save();
    return newTxn;
  }

  async getTransaction(txn_id) {
    await this.init();
    await this.load(); // Load latest from disk
    return this.data.transactions.find(t => t.txn_id === txn_id) || null;
  }

  async updateTransactionStatus(txn_id, status) {
    await this.init();
    await this.load(); // Load latest from disk
    const txn = this.data.transactions.find(t => t.txn_id === txn_id);
    if (txn) {
      txn.status = status;
      txn.updated_at = new Date().toISOString();
      await this.save();
      return txn;
    }
    return null;
  }

  async getPendingTransactions() {
    await this.init();
    await this.load(); // Load latest from disk
    return this.data.transactions.filter(t => t.status === 'PENDING');
  }

  async getTransactions() {
    await this.init();
    await this.load(); // Load latest from disk
    return this.data.transactions;
  }

  async deleteTransaction(txn_id) {
    await this.init();
    await this.load(); // Load latest from disk
    const initialLength = this.data.transactions.length;
    this.data.transactions = this.data.transactions.filter(t => t.txn_id !== txn_id);
    if (this.data.transactions.length < initialLength) {
      await this.save();
      return true;
    }
    return false;
  }

  async clearTransactionsByStatus(status) {
    await this.init();
    await this.load(); // Load latest from disk
    const initialLength = this.data.transactions.length;
    this.data.transactions = this.data.transactions.filter(t => t.status !== status);
    const deletedCount = initialLength - this.data.transactions.length;
    if (deletedCount > 0) {
      await this.save();
    }
    return deletedCount;
  }

  async getAntiRaidConfig() {
    await this.init();
    await this.load();
    if (!this.data.antiraid) {
      this.data.antiraid = {
        enabled: true,
        lockdown: false,
        minAccountAgeHours: 24,
        joinLimit: 5,
        joinWindowSeconds: 10,
        spamLimit: 5,
        spamWindowSeconds: 3,
        maxMentions: 4,
        blockLinks: true,
        alertChannelId: null
      };
      await this.save();
    }
    return this.data.antiraid;
  }

  async updateAntiRaidConfig(updates) {
    await this.init();
    await this.load();
    this.data.antiraid = { ...await this.getAntiRaidConfig(), ...updates };
    await this.save();
    return this.data.antiraid;
  }
}

const db = new JSONDatabase();
export default db;
