/**
 * logger.ts — Structured JSON logger (pino).
 * All log lines include correlation_id when available.
 */
import pino from 'pino';
export declare const logger: pino.Logger<never, boolean>;
export declare function childLogger(correlationId: string): pino.Logger<never, boolean>;
//# sourceMappingURL=logger.d.ts.map