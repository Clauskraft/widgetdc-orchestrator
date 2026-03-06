import { config } from './config.js';
import { logger } from './logger.js';
export function requireApiKey(req, res, next) {
    // If no API key configured, allow all (dev mode)
    if (!config.orchestratorApiKey) {
        next();
        return;
    }
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    // Also accept x-api-key header
    const apiKeyHeader = (req.headers['x-api-key'] ?? '');
    if (token === config.orchestratorApiKey || apiKeyHeader === config.orchestratorApiKey) {
        next();
        return;
    }
    logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized request');
    res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.', status_code: 401 },
    });
}
//# sourceMappingURL=auth.js.map