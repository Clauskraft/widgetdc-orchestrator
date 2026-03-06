/**
 * auth.ts — API key authentication middleware.
 * If ORCHESTRATOR_API_KEY is set, all mutating endpoints require it.
 * GET /health and GET / are always public.
 */
import type { Request, Response, NextFunction } from 'express';
export declare function requireApiKey(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map