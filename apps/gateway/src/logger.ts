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
    // Strip secret-shaped fields from any logged object before it leaves the process
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        '*.apiKey', '*.api_key', '*.token', '*.secret', '*.password', '*.credentials',
        'apiKey', 'api_key', 'token', 'secret', 'password', 'credentials',
        'credentials_enc', 'api_key_enc',
      ],
      censor: '[REDACTED]',
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
