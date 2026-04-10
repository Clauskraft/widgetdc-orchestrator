/**
 * neural-bus.ts — Unified Agent-to-Agent Communication REST API
 *
 * Single bus for ALL agents (internal orchestrator + external OpenClaw).
 * Same endpoints, same message format — no fragmentation.
 *
 * Endpoints:
 * POST /api/bus/broadcast  — send to all agents
 * POST /api/bus/send       — direct message to agent
 * POST /api/bus/publish    — publish to domain channel
 * GET  /api/bus/inbox      — get messages for agent
 * POST /api/bus/ack        — acknowledge message
 * GET  /api/bus/agents     — list registered agents
 * POST /api/bus/register   — register agent on bus
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { logger } from '../logger.js'
import { getRedis } from '../redis.js'

export const neuralBusRouter = Router()

// Message storage in Redis (24h TTL)
const BUS_MESSAGES_KEY = 'neural-bus:messages';
const BUS_AGENTS_KEY = 'neural-bus:agents';
const BUS_INBOX_KEY = 'neural-bus:inbox';
const BUS_TTL = 86400; // 24 hours

interface BusMessage {
  id: string;
  type: string;
  from: string;
  to?: string;
  domain: string;
  subject: string;
  body: unknown;
  priority: string;
  ttl: number;
  replyTo?: string;
  correlationId?: string;
  timestamp: string;
  acknowledgedBy: string[];
}

async function getRedisClient() {
  const redis = getRedis();
  if (!redis) throw new Error('Redis not available');
  return redis;
}

/**
 * POST /api/bus/broadcast
 */
neuralBusRouter.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const msg: BusMessage = {
      ...req.body,
      id: uuid(),
      acknowledgedBy: [],
    };

    // Store message
    await redis.hset(BUS_MESSAGES_KEY, msg.id, JSON.stringify(msg));
    await redis.expire(BUS_MESSAGES_KEY, BUS_TTL);

    // Add to ALL agents' inboxes
    const agents = await redis.hkeys(BUS_AGENTS_KEY);
    for (const agentId of agents) {
      await redis.lpush(`${BUS_INBOX_KEY}:${agentId}`, JSON.stringify(msg));
      await redis.ltrim(`${BUS_INBOX_KEY}:${agentId}`, 0, 99); // keep last 100
    }

    logger.info({ messageId: msg.id, type: 'broadcast', domain: msg.domain, agents: agents.length }, 'Bus broadcast');
    res.json({ success: true, messageId: msg.id, deliveredTo: agents.length });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus broadcast failed');
    res.status(502).json({ error: `Broadcast failed: ${String(err)}` });
  }
});

/**
 * POST /api/bus/send — direct message
 */
neuralBusRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const msg: BusMessage = {
      ...req.body,
      id: uuid(),
      acknowledgedBy: [],
    };

    if (!msg.to) {
      res.status(400).json({ error: 'to (agentId) is required for direct messages' });
      return;
    }

    await redis.hset(BUS_MESSAGES_KEY, msg.id, JSON.stringify(msg));
    await redis.lpush(`${BUS_INBOX_KEY}:${msg.to}`, JSON.stringify(msg));
    await redis.ltrim(`${BUS_INBOX_KEY}:${msg.to}`, 0, 99);

    logger.info({ messageId: msg.id, type: 'direct', from: msg.from, to: msg.to }, 'Bus direct message');
    res.json({ success: true, messageId: msg.id, deliveredTo: msg.to });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus send failed');
    res.status(502).json({ error: `Send failed: ${String(err)}` });
  }
});

/**
 * POST /api/bus/publish — publish to domain channel
 */
neuralBusRouter.post('/publish', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const msg: BusMessage = {
      ...req.body,
      id: uuid(),
      acknowledgedBy: [],
    };

    await redis.hset(BUS_MESSAGES_KEY, msg.id, JSON.stringify(msg));

    // Add to inbox of agents subscribed to this domain
    const agents = await redis.hgetall(BUS_AGENTS_KEY);
    let deliveredTo = 0;
    for (const [agentId, agentJson] of Object.entries(agents)) {
      try {
        const agent = JSON.parse(agentJson as string);
        if (agent.domain === msg.domain || agent.domain === 'all' || agent.capabilities?.includes(msg.domain)) {
          await redis.lpush(`${BUS_INBOX_KEY}:${agentId}`, JSON.stringify(msg));
          await redis.ltrim(`${BUS_INBOX_KEY}:${agentId}`, 0, 99);
          deliveredTo++;
        }
      } catch { /* skip invalid agent data */ }
    }

    logger.info({ messageId: msg.id, type: 'publish', domain: msg.domain, deliveredTo }, 'Bus publish');
    res.json({ success: true, messageId: msg.id, deliveredTo });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus publish failed');
    res.status(502).json({ error: `Publish failed: ${String(err)}` });
  }
});

/**
 * GET /api/bus/inbox?agentId=xxx&domain=xxx&limit=20
 */
neuralBusRouter.get('/inbox', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const agentId = req.query.agentId as string;
    const domain = req.query.domain as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const messages = await redis.lrange(`${BUS_INBOX_KEY}:${agentId}`, 0, limit - 1);
    const parsed = messages.map(m => {
      try { return JSON.parse(m) as BusMessage; } catch { return null; }
    }).filter(Boolean) as BusMessage[];

    // Filter by domain if specified
    const filtered = domain ? parsed.filter(m => m.domain === domain || m.type === 'broadcast') : parsed;

    res.json({ success: true, messages: filtered, count: filtered.length, agentId });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus inbox failed');
    res.status(502).json({ error: `Inbox failed: ${String(err)}` });
  }
});

/**
 * POST /api/bus/ack — acknowledge message
 */
neuralBusRouter.post('/ack', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const { messageId, from: agentId } = req.body;

    if (!messageId || !agentId) {
      res.status(400).json({ error: 'messageId and from (agentId) are required' });
      return;
    }

    const msgJson = await redis.hget(BUS_MESSAGES_KEY, messageId);
    if (!msgJson) {
      res.status(404).json({ error: `Message ${messageId} not found` });
      return;
    }

    const msg: BusMessage = JSON.parse(msgJson);
    if (!msg.acknowledgedBy.includes(agentId)) {
      msg.acknowledgedBy.push(agentId);
      await redis.hset(BUS_MESSAGES_KEY, messageId, JSON.stringify(msg));
    }

    // Remove from agent's inbox
    const inboxKey = `${BUS_INBOX_KEY}:${agentId}`;
    const messages = await redis.lrange(inboxKey, 0, -1);
    const filtered = messages.filter(m => {
      try { const parsed = JSON.parse(m); return parsed.id !== messageId; } catch { return true; }
    });
    await redis.del(inboxKey);
    if (filtered.length > 0) {
      await redis.rpush(inboxKey, ...filtered);
    }

    res.json({ success: true, messageId, acknowledgedBy: agentId });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus ack failed');
    res.status(502).json({ error: `Ack failed: ${String(err)}` });
  }
});

/**
 * GET /api/bus/agents
 */
neuralBusRouter.get('/agents', async (_req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const agents = await redis.hgetall(BUS_AGENTS_KEY);
    const parsed = Object.entries(agents).map(([id, json]) => {
      try { return { id, ...JSON.parse(json as string) }; } catch { return { id }; }
    });
    res.json({ success: true, agents: parsed, count: parsed.length });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus agents failed');
    res.status(502).json({ error: `Agents failed: ${String(err)}` });
  }
});

/**
 * POST /api/bus/register
 */
neuralBusRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const { agentId, name, capabilities = [], domain = 'general', source = 'unknown' } = req.body;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const agentData = {
      agentId,
      name: name ?? agentId,
      capabilities,
      domain,
      source,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    await redis.hset(BUS_AGENTS_KEY, agentId, JSON.stringify(agentData));
    await redis.expire(BUS_AGENTS_KEY, BUS_TTL);

    // Ensure inbox exists
    await redis.lrange(`${BUS_INBOX_KEY}:${agentId}`, 0, 0);

    logger.info({ agentId, name, domain, source }, 'Agent registered on Neural Bus');
    res.json({ success: true, agentId, ...agentData });
  } catch (err) {
    logger.error({ err: String(err) }, 'Bus register failed');
    res.status(502).json({ error: `Register failed: ${String(err)}` });
  }
});
