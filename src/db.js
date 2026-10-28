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
    this.supabaseUrl = process.env.SUPABASE_URL || 'https://nctldqgragkuoaqliwip.supabase.co';
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jdGxkcWdyYWdrdW9hcWxpd2lwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MzIwMDExMywiZXhwIjoyMTA4Nzc2MTEzfQ.eSK0xY2e1ay1BeE0UGbP82mRuxakPQ_QjtfJB-nH-YE';
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
    this.syncUserConfigToSupabase(userId, current).catch(() => {});
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

  /**
   * Save / Sync User to Supabase PostgreSQL (Visible in pgAdmin)
   */
  async saveUserToSupabase(user, plainPassword) {
    if (!this.supabaseClient || !user) return;
    try {
      const row = {
        id: user.id,
        email: user.email,
        name: user.name || user.username || user.email.split('@')[0],
        username: user.username || user.email.split('@')[0],
        password: plainPassword || user.password || null,
        password_hash: user.passwordHash || null,
        role: user.role === 'agency' || user.role === 'Agency Lead' ? 'agency' : (user.role === 'admin' ? 'admin' : 'user'),
        balance: typeof user.balance === 'number' ? user.balance : 25.00,
        plan: user.plan || 'Starter Pacing Pro',
        token: user.token || null,
        updated_at: new Date().toISOString()
      };
      const { error } = await this.supabaseClient.from('users').upsert(row, { onConflict: 'id' });
      if (error) {
        console.warn('[DB] Supabase user upsert notice:', error.message);
      } else {
        console.info(`[DB] Successfully saved user ${user.id} (${user.email}) to Supabase.`);
      }
    } catch (err) {
      console.warn('[DB] Supabase user sync error:', err.message);
    }
  }

  /**
   * Look up user from Supabase if not present in local store
   */
  async fetchUserFromSupabase(loginId) {
    if (!this.supabaseClient || !loginId) return null;
    try {
      const clean = String(loginId).trim().toLowerCase();
      const { data, error } = await this.supabaseClient
        .from('users')
        .select('*')
        .or(`email.ilike.${clean},username.ilike.${clean},id.eq.${clean}`)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          email: data.email,
          name: data.name || data.username || data.email.split('@')[0],
          username: data.username || data.email.split('@')[0],
          password: data.password || undefined,
          passwordHash: data.password_hash || undefined,
          role: data.role || 'user',
          balance: Number(data.balance || 0),
          plan: data.plan || 'Starter Pacing Pro',
          token: data.token || null,
          createdAt: data.created_at
        };
      }
    } catch (err) {
      console.warn('[DB] Supabase fetch user error:', err.message);
    }
    return null;
  }

  /**
   * Sync SMM APIs and Configurations to Supabase
   */
  async syncUserConfigToSupabase(userId, config) {
    if (!this.supabaseClient || !userId) return;
    try {
      // 1. Sync individual SMM APIs to user_apis table
      if (Array.isArray(config.apis)) {
        for (const api of config.apis) {
          if (!api.id) continue;
          await this.supabaseClient.from('user_apis').upsert({
            id: api.id,
            user_id: userId,
            name: api.name || 'SMM Provider',
            url: api.url || '',
            api_key: api.key || '',
            currency: api.currency || 'INR',
            exchange_rate_to_inr: Number(api.exchangeRateToInr || 1.0),
            balance: Number(api.balance || 0),
            services: api.services || [],
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }
      }

      // 2. Sync bundles, active ratios and presets to user_configs table
      await this.supabaseClient.from('user_configs').upsert({
        user_id: userId,
        bundles: config.bundles || [],
        active_ratios: config.activeRatios || {},
        ratio_presets: config.ratioPresets || [],
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      
      console.info(`[DB] Successfully synced SMM APIs and configurations for user ${userId} to Supabase.`);
    } catch (err) {
      console.warn('[DB] Supabase syncUserConfig error:', err.message);
    }
  }

  /**
   * Sync Order & Discrete Runs to Supabase PostgreSQL
   */
  async saveOrderToSupabase(order) {
    if (!this.supabaseClient || !order) return;
    try {
      const orderId = order.id || order.schedulerOrderId;
      const userId = order.userId || 'usr-admin-01';

      // Ensure user exists first for foreign key constraint
      const orderUser = this.getUser(userId);
      await this.saveUserToSupabase(orderUser);

      const orderRow = {
        id: orderId,
        scheduler_order_id: order.schedulerOrderId || orderId,
        user_id: userId,
        name: order.name || `Order ${orderId}`,
        link: order.link || '',
        status: order.status || 'running',
        total_views: Number(order.totalViews || 0),
        total_charge: Number(order.totalCharge || 0),
        currency: order.currency || 'USD',
        scheduled_end_time: order.scheduledEndTime || new Date().toISOString(),
        created_at: order.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await this.supabaseClient.from('orders').upsert(orderRow, { onConflict: 'id' });

      if (Array.isArray(order.runs) && order.runs.length > 0) {
        const runsRows = order.runs.map((r, idx) => ({
          order_id: orderId,
          run_number: r.run || (idx + 1),
          scheduled_at: r.at || new Date().toISOString(),
          views: Number(r.views || 0),
          likes: Number(r.likes || 0),
          shares: Number(r.shares || 0),
          saves: Number(r.saves || 0),
          reposts: Number(r.reposts || 0),
          comments: typeof r.comments === 'string' ? r.comments : (r.comments ? String(r.comments) : ''),
          status: r.status || 'pending',
          skip_reason: r.skipReason || null,
          error: r.error || null
        }));
        await this.supabaseClient.from('order_runs').upsert(runsRows, { onConflict: 'order_id,run_number' });
      }
      console.info(`[DB] Successfully saved order ${orderId} to Supabase.`);
    } catch (err) {
      console.warn('[DB] Supabase saveOrder error:', err.message);
    }
  }
}

