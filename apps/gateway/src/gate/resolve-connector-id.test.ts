import { describe, it, expect } from 'vitest'
import { resolveConnectorId } from './gate-decide-route.js'

// Regression test for T12: gate_events.connector_id used to be hardcoded to
// the literal string 'test' for every gate created via POST /api/gate,
// making the field meaningless for audit/visibility purposes.

describe('resolveConnectorId', () => {
  it('prefers an explicit non-wildcard scope over the action mapping', () => {
    expect(resolveConnectorId('deploy', 'github')).toBe('github')
  })

  it('ignores wildcard scope and falls through to action mapping', () => {
    expect(resolveConnectorId('deploy', '*')).toBe('argocd')
  })

  it('maps terraform actions', () => {
    expect(resolveConnectorId('terraform.apply')).toBe('terraform')
    expect(resolveConnectorId('terraform')).toBe('terraform')
  })

  it('maps deploy-family actions to argocd', () => {
    expect(resolveConnectorId('deploy')).toBe('argocd')
    expect(resolveConnectorId('deploy.trigger_pipeline')).toBe('argocd')
    expect(resolveConnectorId('trigger_pipeline')).toBe('argocd')
    expect(resolveConnectorId('approve_gate')).toBe('argocd')
  })

  it('maps k8s-family actions', () => {
    expect(resolveConnectorId('restart_pod')).toBe('k8s')
    expect(resolveConnectorId('restart')).toBe('k8s')
    expect(resolveConnectorId('scale')).toBe('k8s')
    expect(resolveConnectorId('cordon')).toBe('k8s')
    expect(resolveConnectorId('k8s.drain_node')).toBe('k8s')
  })

  it('maps trigger-action verbs', () => {
    expect(resolveConnectorId('notify_oncall')).toBe('pagerduty')
    expect(resolveConnectorId('escalate')).toBe('pagerduty')
    expect(resolveConnectorId('notify_channel')).toBe('slack')
    expect(resolveConnectorId('block_deploy_gate')).toBe('argocd')
  })

  it('derives connector from a dotted prefix for unrecognized actions', () => {
    expect(resolveConnectorId('sonarqube.rescan')).toBe('sonarqube')
  })

  it('falls back to system for a fully unrecognized action with no dot', () => {
    expect(resolveConnectorId('do_the_thing')).toBe('system')
  })

  it('is case-insensitive on the action verb', () => {
    expect(resolveConnectorId('DEPLOY')).toBe('argocd')
  })

  it('never returns the old hardcoded sentinel', () => {
    const actions = ['deploy', 'restart_pod', 'terraform.apply', 'notify_oncall', 'unknown_action']
    for (const a of actions) {
      expect(resolveConnectorId(a)).not.toBe('test')
    }
  })
})
