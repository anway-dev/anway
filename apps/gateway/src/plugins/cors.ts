import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

export default fp(async function corsPlugin(app: FastifyInstance) {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:8500'
  // Reject wildcard when credentials: true — browsers reject this combination
  // and it is almost certainly a misconfiguration
  const origin = raw === '*' ? 'http://localhost:8500' : raw
  const originList = origin.includes(',') ? origin.split(',').map(o => o.trim()) : origin

  await app.register(cors, {
    origin: originList,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'x-connector-key'],
    credentials: true,
  })
})
