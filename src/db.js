/**
 * BHAVISHYAA Database & Persistence Layer
 * 
 * Supports:
 * - Supabase PostgreSQL connection with fallback to local transactional JSON persistence
 * - Server restart state recovery (reclaims stranded executing runs)
 * - User balance tracking & transactional balance deductions
 * - Order & run persistence
 * - Audit logging
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(path.resolve(__dirname, '..'), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class DatabaseManager {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL || 'https://ofcewgbvfmnjczvzyqqs.supabase.co';
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_UJQYYRLtwyAO_7GONFb88w_wReU-L5F';
    this.supabaseClient = null;

    if (this.supabaseUrl && this.supabaseKey) {
      try {
        this.supabaseClient = createClient(this.supabaseUrl, this.supabaseKey, {
          auth: { persistSession: false }
        });
      } catch (err) {
        console.warn('[DatabaseManager] Supabase initialization failed, falling back to local JSON store:', err.message);
      }
    }

    this.localDb = this.loadLocalDB();
  }

  loadLocalDB() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const content = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(content);
      }
    } catch (err) {
      console.error('[DB] Error loading local DB:', err.message);
    }
    return {
      users: {
        'usr-alex-101': { id: 'usr-alex-101', email: 'alex@bhavishyaa.io', role: 'agency', balance: 1450.00 },
        'usr-licensed-demo': { id: 'usr-licensed-demo', email: 'alex@bhavishyaa.io', role: 'agency', balance: 1450.00 },
        'usr-default-demo': { id: 'usr-default-demo', email: 'demo@bhavishyaa.io', role: 'user', balance: 1000.00 }
      },
      orders: {},
      settings: { minViewsPerRun: 100 },
      auditLogs: []
    };
  }

  saveLocalDB() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.localDb, null, 2), 'utf8');
    } catch (err) {
      console.error('[DB] Error saving local DB:', err.message);
    }
  }

  /**
   * Reconciles database state after a server restart or deployment
   * Recovers any runs left in 'executing' or 'cancelling'
   */
  async recoverAfterRestart(providerReconcileFn) {
    console.info('[DatabaseManager] Checking for incomplete work after restart...');
    let recoveredCount = 0;

    for (const [orderId, order] of Object.entries(this.localDb.orders)) {
      if (order.status !== 'running' && order.status !== 'cancelling') continue;

      const runs = order.runs || [];
      for (const run of runs) {
        if (run.status === 'executing') {
          // Reconcile with provider or safely reset to pending / failed
          console.warn(`[Recovery] Found in-flight run #${run.run} for order ${orderId} from prior crash/restart.`);
          if (providerReconcileFn && run.providerOrderIds && Object.keys(run.providerOrderIds).length > 0) {
            try {
              await providerReconcileFn(order, run);
            } catch (err) {
              run.status = 'failed';
              run.error = `Server restarted while in-flight. Reconcile failed: ${err.message}`;
            }
          } else {
            // Never execute duplicate: if no provider confirmation, mark as skipped/interrupted
            run.status = 'failed';
            run.error = 'Execution interrupted by server restart/redeployment.';
          }
          recoveredCount++;
        }
      }

      // If all runs are terminal, update order status so it is not stranded in running
      const allFinished = runs.length > 0 && runs.every(r => ['completed', 'skipped', 'cancelled', 'failed'].includes(r.status));
      if (allFinished && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'failed') {
        const allFailed = runs.every(r => r.status === 'failed');
        order.status = allFailed ? 'failed' : 'completed';
        order.completedAt = new Date().toISOString();
        recoveredCount++;
      }
    }

    if (recoveredCount > 0) {
      this.saveLocalDB();
      console.info(`[Recovery] Successfully reconciled ${recoveredCount} interrupted run(s) from previous server lifecycle.`);
    } else {
      console.info('[Recovery] Database is clean. No interrupted runs found.');
    }
  }

  getUser(userId) {
    if (!this.localDb.users) this.localDb.users = {};
    if (!this.localDb.users[userId]) {
      this.localDb.users[userId] = {
        id: userId,
        email: `${userId}@bhavishyaa.io`,
        role: 'user',
        balance: 1000.00
      };
      this.saveLocalDB();
    }
    return this.localDb.users[userId];
  }

  getUserConfig(userId) {
    if (!this.localDb.userConfigs) this.localDb.userConfigs = {};
    if (!this.localDb.userConfigs[userId]) {
      const liveKey = process.env.YOYO_API_KEY || process.env.VITE_YOYO_API_KEY || process.env.LIVE_SMM_KEY || process.env.PROVIDER_API_KEY || "demo_yoyo_key_sec_8921";
      const defaultApis = [
        {
          id: "api-yoyo-1",
          name: "Yoyo",
          url: "https://yoyosmm.com/api/v2",
          key: liveKey,
          currency: "INR",
          exchangeRateToInr: 1,
          balance: 8.50,
          services: [
            { service: "101", name: "Instagram Reels Views - High Quality - Non Drop", type: "Default", category: "Instagram Views", rate: "0.01", min: "100", max: "10000000" },
            { service: "102", name: "Instagram Likes - Real Active Accounts", type: "Default", category: "Instagram Likes", rate: "0.05", min: "50", max: "500000" },
            { service: "103", name: "Instagram Shares - Viral Reach Boost", type: "Default", category: "Instagram Shares", rate: "0.03", min: "50", max: "200000" },
            { service: "104", name: "Instagram Saves - Bookmark Boost", type: "Default", category: "Instagram Saves", rate: "0.02", min: "50", max: "200000" },
            { service: "105", name: "Instagram Comments - Positive Random", type: "Default", category: "Instagram Comments", rate: "0.15", min: "10", max: "50000" },
            { service: "106", name: "Instagram Reposts / Story Reshares", type: "Default", category: "Instagram Reposts", rate: "0.08", min: "20", max: "100000" }
          ]
        }
      ];
      const defaultBundles = [
        {
          id: "bundle-ig-1",
          name: "Instagram",
          apiId: "api-yoyo-1",
          serviceIds: {
            views: "101",
            likes: "102",
            shares: "103",
            saves: "104",
            comments: "105",
            reposts: "106"
          }
        }
      ];
      const defaultRatios = {
        likes: 2.5,
        shares: 1.75,
        saves: 0.45,
        comments: 0.05,
        reposts: 0.85
      };
      this.localDb.userConfigs[userId] = {
        apis: defaultApis,
        bundles: defaultBundles,
        activeRatios: defaultRatios,
        ratioPresets: []
      };
      this.saveLocalDB();
    }
    return this.localDb.userConfigs[userId];
  }

  saveUserConfig(userId, updates = {}) {
    const current = this.getUserConfig(userId);
    if (updates.apis !== undefined) current.apis = updates.apis;
    if (updates.bundles !== undefined) current.bundles = updates.bundles;
    if (updates.activeRatios !== undefined) current.activeRatios = updates.activeRatios;
    if (updates.ratioPresets !== undefined) current.ratioPresets = updates.ratioPresets;
    this.saveLocalDB();
    return current;
  }

  deductBalance(userId, amount) {
    const user = this.getUser(userId);
    if (user.balance < amount) {
      throw new Error(`Insufficient funds: Balance is $${user.balance.toFixed(2)}, charge is $${amount.toFixed(2)}`);
    }
    user.balance = Math.round(Math.max(0, user.balance - amount) * 100) / 100;
    this.saveLocalDB();
    return user.balance;
  }

  addBalance(userId, amount, transactionDetails = {}) {
    const user = this.getUser(userId);
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      throw new Error('Deposit amount must be greater than zero.');
    }
    user.balance = Math.round(((user.balance || 0) + numAmount) * 100) / 100;

    if (!this.localDb.transactions) this.localDb.transactions = [];
    const txn = {
      id: transactionDetails.id || `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      userId,
      amount: numAmount,
      type: 'deposit',
      gateway: transactionDetails.gateway || 'stripe',
      status: 'completed',
      balanceAfter: user.balance,
      createdAt: new Date().toISOString()
    };
    this.localDb.transactions.unshift(txn);
    this.saveLocalDB();
    this.logAudit(userId, null, 'deposit_completed', txn);
    return { newBalance: user.balance, transaction: txn };
  }

  getUserTransactions(userId) {
    if (!this.localDb.transactions) this.localDb.transactions = [];
    return this.localDb.transactions.filter(t => t.userId === userId);
  }

  logAudit(userId, orderId, action, details = {}) {
    const logEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId,
      orderId,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    if (!this.localDb.auditLogs) this.localDb.auditLogs = [];
    this.localDb.auditLogs.push(logEntry);
    this.saveLocalDB();
    return logEntry;
  }

  async listAccessKeys() {
    if (!this.localDb.accessKeys) {
      this.localDb.accessKeys = [
        {
          key: "BHAVISHYAA-FPN9-DT6K-GPKE",
          is_active: true,
          duration_seconds: null,
          note: "Default Master Terminal Key",
          created_at: new Date().toISOString()
        }
      ];
      this.saveLocalDB();
    }
    if (this.supabaseClient) {
      try {
        const { data, error } = await this.supabaseClient.from('access_keys').select('*').order('created_at', { ascending: false });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data;
        }
      } catch (err) {
        console.warn('[DB] Supabase access_keys query failed, using local store:', err.message);
      }
    }
    return this.localDb.accessKeys || [];
  }

  async createAccessKey(keyData) {
    if (!this.localDb.accessKeys) this.localDb.accessKeys = [];
    const existingIdx = this.localDb.accessKeys.findIndex(k => k.key === keyData.key);
    const newEntry = {
      key: keyData.key,
      is_active: keyData.is_active !== undefined ? Boolean(keyData.is_active) : true,
      duration_seconds: keyData.duration_seconds || null,
      expires_at: keyData.expires_at || null,
      fingerprint: keyData.fingerprint || null,
      activated_at: keyData.activated_at || null,
      note: keyData.note || null,
      created_at: keyData.created_at || new Date().toISOString()
    };
    if (existingIdx >= 0) {
      this.localDb.accessKeys[existingIdx] = newEntry;
    } else {
      this.localDb.accessKeys.unshift(newEntry);
    }
    this.saveLocalDB();

    if (this.supabaseClient) {
      try {
        await this.supabaseClient.from('access_keys').insert(newEntry);
      } catch (err) {
        console.warn('[DB] Supabase access_key insert failed:', err.message);
      }
    }
    return newEntry;
  }

  async updateAccessKey(key, updates) {
    if (!this.localDb.accessKeys) this.localDb.accessKeys = [];
    const entry = this.localDb.accessKeys.find(k => k.key === key);
    if (entry) {
      Object.assign(entry, updates);
      this.saveLocalDB();
    }
    if (this.supabaseClient) {
      try {
        await this.supabaseClient.from('access_keys').update(updates).eq('key', key);
      } catch (err) {
        console.warn('[DB] Supabase access_key update failed:', err.message);
      }
    }
    return entry;
  }

  async deleteAccessKey(key) {
    if (!this.localDb.accessKeys) this.localDb.accessKeys = [];
    this.localDb.accessKeys = this.localDb.accessKeys.filter(k => k.key !== key);
    this.saveLocalDB();

    if (this.supabaseClient) {
      try {
        await this.supabaseClient.from('access_keys').delete().eq('key', key);
      } catch (err) {
        console.warn('[DB] Supabase access_key delete failed:', err.message);
      }
    }
    return true;
  }
}

