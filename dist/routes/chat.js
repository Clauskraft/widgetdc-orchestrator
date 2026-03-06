/**
 * routes/chat.ts — AgentMessage REST endpoints.
 */
import { Router } from 'express';
import { broadcastMessage, getConnectionStats } from '../chat-broadcaster.js';
import { logger } from '../logger.js';
import { notifyChatMessage } from '../slack.js';
export const chatRouter = Router();
chatRouter.post('/message', (req, res) => {
    const body = req.body;
    if (!body.from || !body.to || !body.source || !body.type || !body.message) {
        res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Required: from, to, source, type, message', status_code: 400 },
        });
        return;
    }
    const msg = { ...body, timestamp: new Date().toISOString() };
    broadcastMessage(msg);
    notifyChatMessage(body.from, body.to, body.message);
    logger.info({ from: msg.from, to: msg.to, type: msg.type }, 'Chat message broadcast');
    res.json({ success: true, data: { timestamp: msg.timestamp } });
});
chatRouter.get('/ws-stats', (_req, res) => {
    res.json({ success: true, data: getConnectionStats() });
});
//# sourceMappingURL=chat.js.map