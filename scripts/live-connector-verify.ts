/**
 * Live connector verification runner — runs a connector's REAL bootstrap and
 * REAL read tools against a REAL service instance (docker container, public
 * sandbox, or LocalStack). No fixtures, no mocks — this is the evidence tier
 * above the fixture-server integration tests and the Prism contract tests.
 *
 * Usage (from anywhere in the repo):
 *   pnpm --filter anway-gateway exec tsx ../../scripts/live-connector-verify.ts \
 *     <connectorDir> '<credsJson>' [toolName paramsJson]...
 *
 * With no [toolName paramsJson] pairs, every read (non-write) tool is invoked
 * with {} — fine for list-style tools, pass explicit params for tools with
 * required arguments.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const [connectorDir, credsJson, ...rest] = process.argv.slice(2)
  if (!connectorDir || !credsJson) {
    console.error('usage: tsx live-connector-verify.ts <connectorDir> <credsJson> [tool paramsJson]...')
    process.exit(2)
  }
  const creds = JSON.parse(credsJson) as Record<string, unknown>
  const mod = await import(path.join(REPO_ROOT, `connectors/${connectorDir}/src/index.ts`))

  // Minimal in-memory IKnowledgeGraph — the packaged FakeKnowledgeGraph lives
  // in the testing helpers which import vitest internals and cannot run
  // standalone. Only the methods bootstraps actually call are implemented.
  class InMemoryKG {
    readonly entities = new Map<string, { type: string; name: string }>()
    relationships = 0
    async upsertEntity(e: { type: string; name: string }): Promise<string> {
      const id = `${e.type}:${e.name}`
      this.entities.set(id, e)
      return id
    }
    async upsertRelationship(): Promise<string> { this.relationships++; return `r${this.relationships}` }
    async addEpisode(): Promise<void> {}
    async getFacts(): Promise<unknown[]> { return [] }
    async getEntity(): Promise<null> { return null }
    async getEntityByExternalRef(): Promise<null> { return null }
    async getRelationships(): Promise<unknown[]> { return [] }
    async search(): Promise<unknown[]> { return [] }
    async resolveContext(): Promise<never> { throw new Error('not implemented') }
    async resolveContextByName(): Promise<null> { return null }
    async markConnectorEntitiesStale(): Promise<number> { return 0 }
    async deleteEntitiesByOrgPrefix(): Promise<number> { return 0 }
    async getEntitiesByConnectorType(): Promise<unknown[]> { return [] }
  }
  const FakeKnowledgeGraph = InMemoryKG

  const AgentClass = Object.values(mod).find((v): v is new () => { tools: Array<{ definition: { name: string }; write: boolean; execute: (p: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown> }> } =>
    typeof v === 'function' && v.name.endsWith('Agent')) as (new () => { tools: Array<{ definition: { name: string }; write: boolean; execute: (p: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown> }> }) | undefined
  const BootstrapClass = Object.values(mod).find((v) => typeof v === 'function' && v.name.endsWith('Bootstrap')) as (new (kg: unknown) => { bootstrap: (t: string, c: string, p: Record<string, unknown>) => Promise<{ entitiesUpserted?: number; relationshipsUpserted?: number }> }) | undefined

  let failures = 0

  if (BootstrapClass) {
    const kg = new FakeKnowledgeGraph()
    try {
      const result = await new BootstrapClass(kg).bootstrap(
        '00000000-0000-0000-0000-000000000001', `live-${connectorDir}`, creds,
      )
      console.log(`BOOTSTRAP OK: entities=${result.entitiesUpserted ?? 'n/a'} relationships=${result.relationshipsUpserted ?? 'n/a'}`)
      const store = (kg as { entities?: Map<string, { type: string; name: string }> | Array<{ type: string; name: string }> }).entities
      if (store) {
        const list = Array.from(store instanceof Map ? store.values() : store)
        console.log(`  graph entities (${list.length}):`, list.slice(0, 8).map(e => `${e.type}:${e.name}`).join(', '))
      }
    } catch (err) {
      console.error(`BOOTSTRAP FAIL: ${err}`)
      failures++
    }
  } else {
    console.log('BOOTSTRAP: none exported')
  }

  if (!AgentClass) {
    console.error('no Agent class exported')
    process.exit(1)
  }
  const agent = new AgentClass()
  const requested: Array<[string, Record<string, unknown>]> = []
  for (let i = 0; i + 1 < rest.length; i += 2) requested.push([rest[i]!, JSON.parse(rest[i + 1]!) as Record<string, unknown>])

  const toolsToRun = requested.length > 0
    ? requested
    : agent.tools.filter(t => !t.write).map(t => [t.definition.name, {}] as [string, Record<string, unknown>])

  for (const [name, params] of toolsToRun) {
    const tool = agent.tools.find(t => t.definition.name === name)
    if (!tool) { console.error(`TOOL ${name}: not found`); failures++; continue }
    try {
      const out = await tool.execute(params, creds)
      const s = JSON.stringify(out)
      console.log(`TOOL ${name} OK: ${s.length > 300 ? s.slice(0, 300) + '…' : s}`)
    } catch (err) {
      console.error(`TOOL ${name} FAIL: ${err}`)
      failures++
    }
  }

  console.log(failures === 0 ? 'LIVE VERIFICATION: PASS' : `LIVE VERIFICATION: ${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
