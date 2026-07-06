import { describe, it, expect } from 'vitest'
import { buildNativeConnectorScopes } from './chat.js'

describe('buildNativeConnectorScopes', () => {
  it('applies user_perimeters read_scopes override when a matching row exists', () => {
    const nativeConnectorRows = [{ connector_type: 'k8s' }]
    const userPerimeterRows = [
      { connector_name: 'k8s', read_scopes: ['namespace/staging'], write_scopes: [] },
    ]

    const result = buildNativeConnectorScopes(nativeConnectorRows, userPerimeterRows, false)

    expect(result).toHaveLength(1)
    const k8s = result.find(s => s.connectorId === 'k8s')
    expect(k8s).toBeDefined()
    expect(k8s!.read).toEqual(['namespace/staging'])
    expect(k8s!.write).toEqual([]) // V1 posture — write always denied
  })

  it('admin defaults to read [\'*\'] when no matching user_perimeters row exists', () => {
    const nativeConnectorRows = [{ connector_type: 'k8s' }]
    const userPerimeterRows: { connector_name: string; read_scopes: string[]; write_scopes: string[] }[] = []

    const result = buildNativeConnectorScopes(nativeConnectorRows, userPerimeterRows, true)

    expect(result).toHaveLength(1)
    expect(result[0]!.read).toEqual(['*'])
    expect(result[0]!.write).toEqual([])
  })

  it('non-admin defaults to read [] (deny) when no matching user_perimeters row exists', () => {
    // Confirmed live via independent review: this previously defaulted to
    // ['*'] (fully open) for every role, not just admin — a real
    // inconsistency with dbConnectors' own default-deny fix and with
    // CLAUDE.md's provisioning model. A non-admin user with no configured
    // perimeter for a native connector must get nothing, same as mcp/cli.
    const nativeConnectorRows = [{ connector_type: 'k8s' }]
    const userPerimeterRows: { connector_name: string; read_scopes: string[]; write_scopes: string[] }[] = []

    const result = buildNativeConnectorScopes(nativeConnectorRows, userPerimeterRows, false)

    expect(result).toHaveLength(1)
    expect(result[0]!.read).toEqual([])
    expect(result[0]!.write).toEqual([])
  })

  it('does not leak a user_perimeters row for one connector into another connector\'s scope', () => {
    const nativeConnectorRows = [
      { connector_type: 'k8s' },
      { connector_type: 'github' },
    ]
    const userPerimeterRows = [
      { connector_name: 'github', read_scopes: ['org/my-team'], write_scopes: [] },
    ]

    const result = buildNativeConnectorScopes(nativeConnectorRows, userPerimeterRows, true)

    expect(result).toHaveLength(2)
    const k8s = result.find(s => s.connectorId === 'k8s')
    const github = result.find(s => s.connectorId === 'github')
    expect(k8s).toBeDefined()
    expect(github).toBeDefined()
    // k8s has no user_perimeters row — admin default is ['*']
    expect(k8s!.read).toEqual(['*'])
    // github has a matching row — should get the override regardless of role
    expect(github!.read).toEqual(['org/my-team'])
  })
})
