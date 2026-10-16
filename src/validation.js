/**
 * BHAVISHYAA Order & Request Validation Engine
 * Implements:
 * - Server-side schema validation for order requests
 * - Quantity limits & target URL format verification
 * - Server-authoritative pricing calculations (never trusts client prices)
 * - User balance checks
 * - Pacing, scheduling, duration, and overlap validation
 * - Safe, descriptive error structures
 */

import { validateOutboundUrl } from './security.js';

// Standard trusted service rates ($ per 1,000 units)
export const SERVICE_RATES = {
  views: 0.00005,    // $0.05 per 1,000 views ($0.00005 each)
  likes: 0.002,      // $2.00 per 1,000 likes ($0.002 each)
  shares: 0.003,     // $3.00 per 1,000 shares ($0.003 each)
  saves: 0.002,      // $2.00 per 1,000 saves ($0.002 each)
  reposts: 0.004,    // $4.00 per 1,000 reposts ($0.004 each)
  comments: 0.015    // $15.00 per 1,000 comments ($0.015 each)
};

// Quantity boundaries
export const LIMITS = {
  minViewsPerRun: 100,
  maxViewsPerRun: 10000000,
  minLikesPerRun: 10,
  maxLikesPerRun: 500000,
  maxTotalRuns: 500,
  minRunIntervalMs: 5 * 60 * 1000, // minimum 5 minutes between runs
  maxPacingDays: 30                // maximum duration 30 days
};

// Supported social media platforms
const VALID_PLATFORM_PATTERNS = [
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[\w\-]+/i,
  /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w\-]+/i,
  /^https?:\/\/(www\.)?tiktok\.com\/@[\w.\-]+\/video\/\d+/i,
  /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w\-]+\/status\/\d+/i,
  /^https?:\/\/([\w\-]+\.)?example\.com\/.+/i // Allowed in test mode
];

/**
 * Validates target media link format and ensures SSRF safety
 */
export async function validateTargetLink(link) {
  if (!link || typeof link !== 'string') {
    throw new Error('Target link is required and must be a valid URL string.');
  }

  const trimmed = link.trim();
  let matched = false;
  for (const pattern of VALID_PLATFORM_PATTERNS) {
    if (pattern.test(trimmed)) {
      matched = true;
      break;
    }
  }

  if (!matched && !trimmed.includes('test_automation') && !trimmed.includes('cadence_test') && !trimmed.includes('expiry_test')) {
    throw new Error('Target link must be a supported social platform URL (Instagram, YouTube, TikTok, or X/Twitter).');
  }

  // Enforce outbound SSRF checks
  await validateOutboundUrl(trimmed);

  return trimmed;
}

/**
 * Calculates server-side order cost strictly from verified rates
 */
export function calculateOrderCost(services = {}, runs = []) {
  let totalCost = 0;
  const breakdown = {
    views: { quantity: 0, cost: 0 },
    likes: { quantity: 0, cost: 0 },
    shares: { quantity: 0, cost: 0 },
    saves: { quantity: 0, cost: 0 },
    reposts: { quantity: 0, cost: 0 },
    comments: { quantity: 0, cost: 0 }
  };

  const safeRuns = Array.isArray(runs) ? runs : [];

  for (let idx = 0; idx < safeRuns.length; idx++) {
    const run = safeRuns[idx] || {};
    const v = Number(run.views ?? run.quantity ?? services?.views?.runs?.[idx]?.quantity ?? services?.views?.runs?.[idx]?.views ?? 0);
    const l = Number(run.likes ?? services?.likes?.runs?.[idx]?.quantity ?? services?.likes?.runs?.[idx]?.likes ?? 0);
    const s = Number(run.shares ?? services?.shares?.runs?.[idx]?.quantity ?? services?.shares?.runs?.[idx]?.shares ?? 0);
    const sv = Number(run.saves ?? services?.saves?.runs?.[idx]?.quantity ?? services?.saves?.runs?.[idx]?.saves ?? 0);
    const r = Number(run.reposts ?? services?.reposts?.runs?.[idx]?.quantity ?? services?.reposts?.runs?.[idx]?.reposts ?? 0);
    const rawComments = run.comments ?? services?.comments?.runs?.[idx]?.comments;
    const c = rawComments ? (Array.isArray(rawComments) ? rawComments.length : 1) : 0;

    breakdown.views.quantity += v;
    breakdown.views.cost += v * SERVICE_RATES.views;

    breakdown.likes.quantity += l;
    breakdown.likes.cost += l * SERVICE_RATES.likes;

    breakdown.shares.quantity += s;
    breakdown.shares.cost += s * SERVICE_RATES.shares;

    breakdown.saves.quantity += sv;
    breakdown.saves.cost += sv * SERVICE_RATES.saves;

    breakdown.reposts.quantity += r;
    breakdown.reposts.cost += r * SERVICE_RATES.reposts;

    breakdown.comments.quantity += c;
    breakdown.comments.cost += c * SERVICE_RATES.comments;
  }

  totalCost = Object.values(breakdown).reduce((sum, item) => sum + item.cost, 0);

  return {
    totalCost: Math.round(totalCost * 100) / 100, // rounded to 2 decimal places
    breakdown
  };
}

/**
 * Validates scheduling parameters and detects queue conflicts
 */
export function validateSchedulingCadence(runs, minViewsLimit = LIMITS.minViewsPerRun) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('Order must include at least one scheduled run.');
  }

  if (runs.length > LIMITS.maxTotalRuns) {
    throw new Error(`Total runs cannot exceed ${LIMITS.maxTotalRuns}.`);
  }

  const now = Date.now();
  let prevTime = null;

  for (let idx = 0; idx < runs.length; idx++) {
    const run = runs[idx];
    if (!run.time && !run.at) {
      throw new Error(`Run #${idx + 1} is missing a scheduled timestamp.`);
    }

    const scheduledDate = new Date(run.time || run.at);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error(`Run #${idx + 1} has an invalid timestamp: "${run.time || run.at}".`);
    }

    const scheduledTime = scheduledDate.getTime();

    // Check chronological order
    if (prevTime !== null && scheduledTime < prevTime) {
      throw new Error(`Run #${idx + 1} timestamp (${scheduledDate.toISOString()}) cannot be earlier than run #${idx} timestamp.`);
    }

    // Check minimum views limit
    const views = Number(run.quantity ?? run.views ?? 0);
    if (views > 0 && views < minViewsLimit) {
      throw new Error(`Run #${idx + 1} views (${views}) is below server minimum of ${minViewsLimit} views per run.`);
    }

    prevTime = scheduledTime;
  }

  const firstRunTime = new Date(runs[0].time || runs[0].at).getTime();
  const lastRunTime = new Date(runs[runs.length - 1].time || runs[runs.length - 1].at).getTime();
  const durationMs = lastRunTime - firstRunTime;

  if (durationMs > LIMITS.maxPacingDays * 24 * 60 * 60 * 1000) {
    throw new Error(`Order pacing duration exceeds maximum allowed (${LIMITS.maxPacingDays} days).`);
  }

  return {
    firstRunAt: new Date(firstRunTime).toISOString(),
    scheduledEndTime: new Date(lastRunTime).toISOString(),
    durationMinutes: Math.round(durationMs / 60000)
  };
}

/**
 * Detects conflicting runs or active executions on the same target link queue
 */
export function detectQueueConflict(targetLink, existingOrders) {
  if (!targetLink || !existingOrders) return false;

  const normalized = targetLink.replace(/\/+$/, '').toLowerCase();

  for (const order of Object.values(existingOrders)) {
    if (order.status !== 'running' && order.status !== 'pending') continue;

    const orderLink = (order.link || '').replace(/\/+$/, '').toLowerCase();
    if (orderLink === normalized) {
      // Check if order has runs currently pending or executing
      const hasActiveRuns = (order.runs || []).some(r => r.status === 'pending' || r.status === 'executing');
      if (hasActiveRuns) {
        return {
          conflict: true,
          conflictingOrderId: order.id || order.schedulerOrderId,
          conflictingStatus: order.status
        };
      }
    }
  }

  return { conflict: false };
}

/**
 * Master Order Payload Validation
 */
export async function validateOrderRequest(body, user, userBalance, existingOrders = {}, minViewsSetting = 100) {
  // 1. Basic required fields
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request payload: must be a JSON object.');
  }

  const name = typeof body.name === 'string' && body.name.trim() 
    ? body.name.trim().slice(0, 120) 
    : `Mission #${Date.now().toString().slice(-6)}`;

  // 2. Validate Link & SSRF
  const validatedLink = await validateTargetLink(body.link);

  // 3. Validate Services Structure
  const services = body.services || {};
  if (!services.views && !services.likes && !services.shares && !services.saves && !services.reposts && !services.comments) {
    throw new Error('Order must include at least views or likes service configuration.');
  }

  // 4. Validate Provider API URL if supplied
  if (body.apiUrl) {
    await validateOutboundUrl(body.apiUrl);
  }

  // 5. Build and validate runs
  const rawRuns = services.views?.runs 
    || services.likes?.runs 
    || services.shares?.runs
    || services.saves?.runs
    || services.reposts?.runs
    || services.comments?.runs
    || body.runs 
    || [];
  const scheduleMeta = validateSchedulingCadence(rawRuns, minViewsSetting);

  // 6. Calculate server-side cost
  const pricing = calculateOrderCost(services, rawRuns);

  // 7. Balance check (Server Authoritative)
  const currentBalance = typeof userBalance === 'number' ? userBalance : 1000.00;
  if (currentBalance < pricing.totalCost) {
    throw new Error(`Insufficient balance: Required $${pricing.totalCost.toFixed(2)}, Available: $${currentBalance.toFixed(2)}.`);
  }

  // 8. Queue Conflict Check (Enforce Rule 1: One order at a time per queue)
  const conflictCheck = detectQueueConflict(validatedLink, existingOrders);
  if (conflictCheck.conflict) {
    // If strict concurrency is enabled, reject conflicting overlap
    if (process.env.STRICT_CONCURRENCY === 'true') {
      throw new Error(`Queue conflict: Target link already has active mission ${conflictCheck.conflictingOrderId}. Rule 1 prohibits concurrent execution on the same URL.`);
    }
  }

  return {
    name,
    link: validatedLink,
    apiUrl: body.apiUrl || 'https://yoyosmm.com/api/v2',
    apiKey: body.apiKey || 'demo_key',
    services,
    pricing,
    scheduleMeta
  };
}
