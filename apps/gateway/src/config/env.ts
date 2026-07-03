import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().optional(),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
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
  ANWAY_ENCRYPTION_KEY: z.string().min(1, 'ANWAY_ENCRYPTION_KEY is required for connector credential encryption'),
  ANWAY_WEBHOOK_TOKEN: z.string().optional(),
  ANWAY_WEBHOOK_TENANT: z.string().optional(),
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
  const hasRs256 = process.env['JWT_PRIVATE_KEY'] && process.env['JWT_PUBLIC_KEY']
  if (!hasRs256) {
    const secret = process.env['JWT_SECRET']
    if (!secret || secret === 'dev-secret-change-in-production' || secret.length < 32) {
      throw new Error('Production requires either JWT_PRIVATE_KEY+JWT_PUBLIC_KEY (RS256) or JWT_SECRET >=32 chars')
    }
  }
}
