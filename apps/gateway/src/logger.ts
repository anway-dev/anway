import pino from 'pino'

export function createLogger(context: { service: string; version?: string; env?: string }) {
  const env = context.env ?? process.env.NODE_ENV ?? 'development'
  const isDev = env === 'development'

  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: context.service,
      version: context.version ?? process.env.APP_VERSION ?? '0.0.1',
      env,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  })
}

export const logger = createLogger({ service: 'anvay-gateway' })
