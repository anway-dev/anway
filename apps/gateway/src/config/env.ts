import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  OLLAMA_ENDPOINT: z.string().optional(),
  LMSTUDIO_ENDPOINT: z.string().optional(),
  REDIS_URL: z.string().optional(),
  LINEAR_API_KEY: z.string().optional(),
  DATADOG_API_KEY: z.string().optional(),
  DATADOG_APP_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues
      .filter((i) => i.code === 'invalid_type')
      .map((i) => i.path.join('.'))
    if (missing.length > 0) {
      throw new Error(`Invalid or missing environment variables: ${missing.join(', ')}`)
    }
    throw new Error(`Invalid environment: ${result.error.message}`)
  }
  return result.data
}

export function assertSecureJwtSecret(): void {
  if (process.env['NODE_ENV'] !== 'production') return
  const secret = process.env['JWT_SECRET']
  if (!secret || secret === 'dev-secret-change-in-production' || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production (not the dev default)')
  }
}
