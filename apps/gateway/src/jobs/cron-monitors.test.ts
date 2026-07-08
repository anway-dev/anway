import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ prisma: {} }))

const qr = vi.fn()
const er = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: qr, $executeRaw: er })
  ),
}))

import { SloBurnCheck, CloudSecurityScan, CostAnomalyDetection } from './cron-monitors.js'

beforeEach(() => {
  qr.mockReset()
  er.mockReset()
})

describe('SloBurnCheck', () => {
  // Regression test: nothing in this codebase ever writes
  // errorBudget/burnRate1h/burnRate6h onto a Service entity — this
  // previously defaulted every missing field and reported 'ok', which is
  // indistinguishable from "checked every service and none are burning".
  it('reports no_data when no service has ever had real SLO metadata computed', async () => {
    qr.mockResolvedValueOnce([
      { name: 'payments-api', metadata: {} },
      { name: 'checkout-api', metadata: { health: 'ok' } },
    ])
    const result = await new SloBurnCheck().run('tenant-1')
    expect(result.status).toBe('no_data')
    expect(result.services).toBe(2)
    expect(result.burningServices).toEqual([])
  })

  it('reports burning when a service has real burn-rate data over threshold', async () => {
    qr.mockResolvedValueOnce([
      { name: 'payments-api', metadata: { burnRate1h: 1.5, burnRate6h: 1.2, errorBudget: 0.3 } },
    ])
    const result = await new SloBurnCheck().run('tenant-1')
    expect(result.status).toBe('burning')
    expect(result.burningServices).toEqual([{ name: 'payments-api', burnRate1h: 1.5, burnRate6h: 1.2 }])
  })

  it('reports ok when real SLO data exists and nothing is burning', async () => {
    qr.mockResolvedValueOnce([
      { name: 'payments-api', metadata: { burnRate1h: 0.2, burnRate6h: 0.1, errorBudget: 0.9 } },
    ])
    const result = await new SloBurnCheck().run('tenant-1')
    expect(result.status).toBe('ok')
  })
})

describe('CloudSecurityScan', () => {
  it('reports no_data when a cloud connector is configured but zero Finding entities have ever been ingested', async () => {
    qr.mockResolvedValueOnce([{ count: 1n }]) // hasCloudConnector
    qr.mockResolvedValueOnce([{ count: 0n }]) // Finding count
    const result = await new CloudSecurityScan().run('tenant-1')
    expect(result.status).toBe('no_data')
    expect(result.findings).toBe(0)
  })

  it('reports unconfigured when no cloud connector is configured at all', async () => {
    qr.mockResolvedValueOnce([{ count: 0n }]) // hasCloudConnector
    const result = await new CloudSecurityScan().run('tenant-1')
    expect(result.status).toBe('unconfigured')
  })
})

describe('CostAnomalyDetection', () => {
  it('reports no_data when a cloud connector is configured but zero Cost entities have ever been ingested', async () => {
    qr.mockResolvedValueOnce([{ count: 1n }]) // hasCloudConnector
    qr.mockResolvedValueOnce([]) // Cost rows
    const result = await new CostAnomalyDetection().run('tenant-1')
    expect(result.status).toBe('no_data')
    expect(result.dailySpend).toBe(0)
  })

  it('reports unconfigured when no cloud connector is configured at all', async () => {
    qr.mockResolvedValueOnce([{ count: 0n }]) // hasCloudConnector
    const result = await new CostAnomalyDetection().run('tenant-1')
    expect(result.status).toBe('unconfigured')
  })
})
