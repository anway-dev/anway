# Opus cross-check audit — 2026-06-14

Verdict: "Phases 1-4 mostly done, 38/38 green" is materially OVERSTATED. Cert suite is
green but exercises shallow proxies for the 3 highest-value capabilities. Phase 1 security
is genuinely solid; Phases 2-4 are wired but their core intelligence paths are uncertified.

## CRITICAL
- C1. No cert exercises orchestrator chat end-to-end. CERT C only checks `configured:true`,
  not a real inference. The provider regression (just fixed) could ship green again.
- C2. Graph-builder LLM extraction (G2 ticket→service, "Wave 5 certified") has NO cert.
  Only certed bootstrap is prometheus (zero LLM calls). The moat path is untested.
- C3. Automation triggers never proven to FIRE. CERT G is CRUD-only.

## HIGH
- H1. CERT K perimeter = CRUD echo, not a hard_block enforcement assertion (plan S4.5 unmet).
- H2. connectors.config_encrypted undropped schema drift (dead column; at-rest cert blind to it).
- H3. Incident SRE auto-root-cause has no cert.
- H4. CERT R (lifecycle) is the ONLY live-LLM cert — fragile, key-dependent.

## MEDIUM
- M1. effectiveApiKey() still references dropped api_key column (latent landmine).
- M2. G1 episodic deferred — structural graph real, temporal reasoning NOT working. Don't demo it.
- M3. P5 banners — verified real. No overstatement.

## Sound (verified): S1 encryption at rest, S2.1 JWT guard, S2.4 rate-limit, webhook auth,
audit + NDJSON export.

## Top 5 DD failures: chat untested, graph extraction uncertified, perimeter is CRUD echo,
triggers storage-only, schema drift. Plus (this session): configured LLM key is invalid (401).
