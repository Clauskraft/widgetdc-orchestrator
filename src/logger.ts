/**
 * logger.ts — Structured JSON logger (pino).
 * All log lines include correlation_id when available.
 */
import pino from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  ...(config.nodeEnv !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
  base: { service: 'orchestrator', version: '1.0.0' },
})

export function childLogger(correlationId: string) {
  return logger.child({ correlation_id: correlationId })
}
