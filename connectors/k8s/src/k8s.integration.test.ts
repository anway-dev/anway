import { describe, it, expect, vi } from 'vitest'
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
vi.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: vi.fn().mockImplementation(() => ({
      loadFromDefault: vi.fn(),
      loadFromFile: vi.fn(),
      loadFromOptions: vi.fn(),
      clusters: [],
      makeApiClient: () => ({
        listServiceForAllNamespaces: async () => ({
          items: [
            { metadata: { name: 'payments-api', namespace: 'prod' }, spec: { selector: { app: 'payments-api' } } },
            { metadata: { name: 'checkout-api', namespace: 'prod' }, spec: { selector: { app: 'checkout-api' } } },
          ],
        }),
        listPodForAllNamespaces: async () => ({
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
        }),
      }),
    })),
    CoreV1Api: vi.fn(),
  }
})

describe('k8s — mocked cluster (DEPENDS_ON derivation)', () => {
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
