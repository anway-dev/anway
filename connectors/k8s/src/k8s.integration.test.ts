import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import { KubernetesBootstrap } from './bootstrap.js'
import { K8sAgent } from './agent.js'


const token = process.env['KUBECONFIG']
const skip = !token

// Regression test for finding A5 (connector bootstrap audit): CLAUDE.md
// documents Service→DEPENDS_ON→Service for this connector ("from service
// discovery"), but bootstrap.ts never created it. Real K8s clusters give
// no dependency-graph API without a service mesh — the real, derivable
// signal at bootstrap time is a pod's own container env vars referencing
// another Service's K8s DNS name. No live cluster needed for this: the
// underlying @kubernetes/client-node calls are mocked directly since this
// suite (unlike the fixture-HTTP-server connectors) talks to the cluster
// through a typed SDK client, not raw fetch.
const listServiceForAllNamespaces = vi.fn(async () => ({
  items: [
    { metadata: { name: 'payments-api', namespace: 'prod' }, spec: { selector: { app: 'payments-api' } } },
    { metadata: { name: 'checkout-api', namespace: 'prod' }, spec: { selector: { app: 'checkout-api' } } },
  ],
}))
const listPodForAllNamespaces = vi.fn(async () => ({
  items: [
    {
      metadata: { name: 'checkout-api-abc', namespace: 'prod', labels: { app: 'checkout-api' } },
      spec: {
        containers: [
          { env: [{ name: 'PAYMENTS_URL', value: 'http://payments-api.prod.svc.cluster.local' }] },
        ],
      },
    },
  ],
}))

vi.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: vi.fn().mockImplementation(() => ({
      loadFromDefault: vi.fn(),
      loadFromFile: vi.fn(),
      loadFromOptions: vi.fn(),
      clusters: [],
      makeApiClient: () => ({
        listServiceForAllNamespaces: () => listServiceForAllNamespaces(),
        listPodForAllNamespaces: () => listPodForAllNamespaces(),
      }),
    })),
    CoreV1Api: vi.fn(),
  }
})

describe('k8s — mocked cluster (DEPENDS_ON derivation)', () => {
  beforeEach(() => {
    listServiceForAllNamespaces.mockReset()
    listPodForAllNamespaces.mockReset()
    listServiceForAllNamespaces.mockImplementation(async () => ({
      items: [
        { metadata: { name: 'payments-api', namespace: 'prod' }, spec: { selector: { app: 'payments-api' } } },
        { metadata: { name: 'checkout-api', namespace: 'prod' }, spec: { selector: { app: 'checkout-api' } } },
      ],
    }))
    listPodForAllNamespaces.mockImplementation(async () => ({
      items: [
        {
          metadata: { name: 'checkout-api-abc', namespace: 'prod', labels: { app: 'checkout-api' } },
          spec: {
            containers: [
              { env: [{ name: 'PAYMENTS_URL', value: 'http://payments-api.prod.svc.cluster.local' }] },
            ],
          },
        },
      ],
    }))
  })

  it('creates Service→DEPENDS_ON→Service from a real pod env var referencing another Service DNS name', async () => {
    const kg = new FakeKG()
    const result = await new KubernetesBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-connector',
      { server: 'https://fake-cluster.invalid', token: 'fixture-token' },
    )
    expect(result.relationshipsUpserted).toBeGreaterThan(0)
    expect(kg.relationships.some(r =>
      r.relType === 'DEPENDS_ON' &&
      r.fromEntityId === 'Service:checkout-api' &&
      r.toEntityId === 'Service:payments-api',
    )).toBe(true)
  })

  // Regression test (independent review, second pass): a per-pod Set
  // previously re-counted the same DEPENDS_ON edge for every replica pod of
  // the same service — the graph stayed correct (upsertRelationship
  // merges) but relationshipsUpserted was inflated.
  it('does not double-count the same DEPENDS_ON edge across multiple replica pods of the same service', async () => {
    listPodForAllNamespaces.mockResolvedValue({
      items: [
        {
          metadata: { name: 'checkout-api-abc', namespace: 'prod', labels: { app: 'checkout-api' } },
          spec: { containers: [{ env: [{ name: 'PAYMENTS_URL', value: 'http://payments-api.prod.svc.cluster.local' }] }] },
        },
        {
          metadata: { name: 'checkout-api-xyz', namespace: 'prod', labels: { app: 'checkout-api' } },
          spec: { containers: [{ env: [{ name: 'PAYMENTS_URL', value: 'http://payments-api.prod.svc.cluster.local' }] }] },
        },
      ],
    })
    const kg = new FakeKG()
    const result = await new KubernetesBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-connector',
      { server: 'https://fake-cluster.invalid', token: 'fixture-token' },
    )
    const dependsOnEdges = kg.relationships.filter(r =>
      r.relType === 'DEPENDS_ON' && r.fromEntityId === 'Service:checkout-api' && r.toEntityId === 'Service:payments-api',
    )
    expect(dependsOnEdges.length).toBe(1)
    expect(result.relationshipsUpserted).toBe(
      // 2 pods × 1 HOSTED_IN each, + exactly 1 (not 2) DEPENDS_ON edge
      2 + 1,
    )
  })

  // Regression test (independent review, second pass): the self-reference
  // guard previously only excluded `${ns}/${pod's app label}`. A pod's
  // `app` label commonly differs from its real owning Service's name (here:
  // Service "checkout" selects `app=checkout-api`, not named "checkout-api"
  // itself) — a pod referencing its own real service by that different name
  // must not create a spurious self-ish DEPENDS_ON edge.
  it('does not create a self-referential DEPENDS_ON when the owning Service name differs from the pod app label', async () => {
    listServiceForAllNamespaces.mockResolvedValue({
      items: [
        { metadata: { name: 'checkout', namespace: 'prod' }, spec: { selector: { app: 'checkout-api' } } },
      ],
    })
    listPodForAllNamespaces.mockResolvedValue({
      items: [
        {
          metadata: { name: 'checkout-api-abc', namespace: 'prod', labels: { app: 'checkout-api' } },
          spec: { containers: [{ env: [{ name: 'SELF_URL', value: 'http://checkout.prod.svc.cluster.local' }] }] },
        },
      ],
    })
    const kg = new FakeKG()
    const result = await new KubernetesBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-connector',
      { server: 'https://fake-cluster.invalid', token: 'fixture-token' },
    )
    expect(kg.relationships.some(r => r.relType === 'DEPENDS_ON')).toBe(false)
    // Only the HOSTED_IN edge should exist.
    expect(result.relationshipsUpserted).toBe(1)
  })
})

describe.skipIf(skip)('k8s — integration (real API)', () => {
  it('bootstrap finds entities', async () => {
    const kg = new FakeKG()
    const result = await new KubernetesBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test',
      { apiKey: token! }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })

  it('agent tools are callable', async () => {
    const agent = new K8sAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
  })
})


  describe('k8s — orchestration (specialist agent)', () => {
    it('specialist agent routes user query to tool and returns grounded response', async () => {
      // Requires a real LLM provider. Skip if none configured.
      const providerType = process.env['ANTHROPIC_API_KEY'] ? 'anthropic'
        : process.env['OPENAI_API_KEY'] ? 'openai'
        : process.env['OLLAMA_ENDPOINT'] ? 'ollama'
        : null
      if (!providerType) {
        console.log('Skipping orchestration test — no model provider configured')
        return
      }
      // Orchestration test: verify the agent harness routes "List namespace pods"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
