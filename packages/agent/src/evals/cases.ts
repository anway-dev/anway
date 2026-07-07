import type { EvalCase } from './types.js'

export const productEvals: EvalCase<string>[] = [
  {
    id: 'product-health-badge',
    agentAction: 'ProductAgent.writePRD',
    input: 'Add a "service health badge" widget to the service catalog page that shows green/yellow/red based on the last 15 minutes of error rate for that service.',
    rubric: [
      '- title is specific to the feature, not generic',
      '- problem statement identifies a real user pain point, not just restating the feature',
      '- goals are concrete and testable (not vague aspirations)',
      '- at least one userStory has acceptance criteria that reference the actual green/yellow/red thresholds or the 15-minute window from the request',
      '- nonGoals meaningfully scope the feature out from adjacent work (not empty or trivial)',
      '- no fabricated specifics not implied by the request (e.g. inventing a specific SLA number with no basis)',
    ].join('\n'),
  },
]

export const techspecEvals: EvalCase<{ prdTitle: string; prdGoals: string[] }>[] = [
  {
    id: 'techspec-health-badge',
    agentAction: 'TechSpecAgent.writeTechSpec',
    input: { prdTitle: 'Service Health Badge Widget for Service Catalog', prdGoals: ['Real-time green/yellow/red health indicator per service based on 15-minute error rate'] },
    rubric: [
      '- architecture description explains where the health computation happens (client vs server) and how data flows',
      '- at least one component addresses computing/aggregating the error-rate-based status',
      '- at least one apiChange is a GET endpoint appropriate for reading health status',
      '- securityConsiderations mentions authentication or authorization, not just generic "use HTTPS"',
      '- estimatedComplexity is a plausible value (low/medium/high) given the described scope, not always defaulting to "medium"',
    ].join('\n'),
  },
]

export const reviewEvals: EvalCase<{ diffSummary: string; prTitle: string }>[] = [
  {
    id: 'review-sql-injection',
    agentAction: 'ReviewAgent.review',
    input: {
      prTitle: 'Add search endpoint for service catalog',
      diffSummary: `+app.get('/api/search', async (req, reply) => {\n+  const q = req.query.q\n+  const rows = await db.query(\`SELECT * FROM services WHERE name LIKE '%\${q}%'\`)\n+  return rows\n+})`,
    },
    rubric: [
      '- at least one blocking finding identifies the SQL injection vulnerability (string interpolation into a raw SQL query)',
      '- the finding correctly names the file/line area (the query line) as the location',
      '- approvalRecommendation is NOT "approve" given a real blocking security issue is present',
      '- suggestion for the injection finding proposes parameterized queries or an ORM, not a vague "be careful"',
    ].join('\n'),
  },
]

export const sreEvals: EvalCase<{ alertTitle: string; alertDescription: string }>[] = [
  {
    id: 'sre-error-rate-spike',
    agentAction: 'SREAgent.assembleContext',
    input: {
      alertTitle: 'payments-api error rate spike',
      alertDescription: 'payments-api 5xx error rate jumped to 12% starting 20:05 UTC, no known deploy in the last hour',
    },
    rubric: [
      '- hypothesis explicitly notes the absence of a recent deploy as a relevant signal (since the description says so), rather than assuming a deploy caused it',
      '- hypothesis proposes at least 2 distinct plausible root-cause categories (e.g. downstream dependency, resource exhaustion, config/secret change, infra issue) rather than one guess stated as fact',
      '- hypothesis does not fabricate specific unavailable data (e.g. inventing a specific CPU percentage or a named root cause with false certainty) — CLAUDE.md\'s anti-hallucination rule requires explicitly noting when data is unavailable',
      '- includes at least one concrete, actionable next step (not just "investigate further")',
    ].join('\n'),
  },
]

export const testEvals: EvalCase<{ title: string; components: Array<{ name: string; technology: string }>; apiChanges: Array<{ method: string; path: string }> }>[] = [
  {
    id: 'test-plan-health-badge',
    agentAction: 'TestAgent.writeTestPlan',
    input: {
      title: 'Service Health Badge Widget',
      components: [{ name: 'HealthBadgeWidget', technology: 'React' }],
      apiChanges: [{ method: 'GET', path: '/api/health/:serviceId' }],
    },
    rubric: [
      '- unitTests reference the actual named component (HealthBadgeWidget), not a generic unrelated component',
      '- at least one integrationTest covers the actual API endpoint mentioned (GET /api/health/:serviceId), not a made-up unrelated endpoint',
      '- e2eScenarios describe realistic user-facing behavior for a health badge (e.g. color changes, updates over time), not generic boilerplate',
      '- coverageTarget is a plausible percentage (0-100), not fabricated or nonsensical',
    ].join('\n'),
  },
]

export const bootstrapEvals: EvalCase<{ title: string; architecture: string; components: string[] }>[] = [
  {
    id: 'bootstrap-health-badge',
    agentAction: 'BootstrapAgent.planBootstrap',
    input: {
      title: 'Service Health Badge Widget',
      architecture: 'Client-side React component polls a REST API; backend aggregates error rates and caches results.',
      components: ['HealthBadgeWidget', 'HealthAggregationService'],
    },
    rubric: [
      '- files list includes at least one file directly implementing the named components (not generic boilerplate unrelated to the spec)',
      '- prDescription accurately summarizes what the files actually do, not a generic template description',
      '- commands are real, plausible shell commands for the stack implied by the spec (not fabricated or nonsensical)',
      '- no fabricated file paths that ignore the architecture description entirely (e.g. adding a totally unrelated database migration with no basis in the spec)',
    ].join('\n'),
  },
]

export const deployEvals: EvalCase<{ service: string; env: string; sha: string }>[] = [
  {
    id: 'deploy-payments-api-prod',
    agentAction: 'DeployAgent.planDeploy',
    input: { service: 'payments-api', env: 'production', sha: 'a4f21bc' },
    rubric: [
      '- strategy choice (rolling/blue_green/canary) is a real, valid enum value, not fabricated',
      '- preChecks include at least one concrete, actionable check (not just "verify everything is fine")',
      '- rollbackTriggers name concrete, measurable conditions (e.g. error rate threshold, health check failure), not vague statements',
      '- confidence is a plausible number between 0 and 1 given there is no real deploy history available (should not be an overconfident 0.95+ with no supporting data)',
    ].join('\n'),
  },
]

export const oncallEvals: EvalCase<string>[] = [
  {
    id: 'oncall-shift-brief',
    agentAction: 'OncallAgent.generateShiftBrief',
    input: 'payments-team',
    // Rubric corrected after this eval — added to close finding I8's "no
    // primary-chat-path coverage" gap — caught a real live fabrication bug:
    // OncallAgent's cheap-model extraction stage was unconditionally
    // instructed to "summarise recent activity" even with zero real
    // episode data, so it invented a plausible-sounding narrative that the
    // main model's own anti-hallucination check couldn't detect (fixed in
    // oncall.ts). This eval harness's noopGraph always resolves to no
    // context, so "genuine synthesis" and "actionable guidance" are not
    // achievable outcomes here — the ONLY correct, honest response to a
    // genuinely empty knowledge graph is stating that plainly. The
    // previous rubric implicitly rewarded a rich-sounding narrative
    // regardless of whether real data backed it, punishing the honest
    // "no data" response this eval's own harness makes the only truthful
    // one.
    rubric: [
      '- since this eval harness never provides real incident/deploy/episode data, the response must explicitly say no real activity data was available, not fabricate specific incident titles, severities, deploy SHAs, or counts',
      '- openIncidents and recentDeploys are empty arrays, not invented entries',
      '- summary and handoffNotes acknowledge the lack of real data honestly rather than inventing a plausible-sounding narrative to fill the gap',
      '- watchItems (if any) are empty or genuinely generic-but-honest ("no data available to identify watch items"), not fabricated specifics',
    ].join('\n'),
  },
]

export const baEvals: EvalCase<string>[] = [
  {
    id: 'ba-adoption-query',
    agentAction: 'BAAgent.analyze',
    input: 'How is the new checkout flow performing since launch?',
    rubric: [
      '- if no real underlying metrics data was available in context, the report explicitly says data is unavailable rather than fabricating specific numbers (e.g. a precise conversion rate percentage with no basis)',
      '- metrics array entries (if any) have plausible labels relevant to a checkout flow (e.g. conversion rate, drop-off, error rate), not generic placeholders',
      '- recommendations are specific and actionable, not generic business platitudes',
      '- summary does not claim false certainty about performance trends it cannot know without real data',
    ].join('\n'),
  },
]

// Primary chat path — the actual user-facing entry point (createOrchestrator
// + runSession), not a single specialist agent method. Previously had zero
// eval coverage at all (finding I8) despite being the most common real
// query shape (general questions with no specific service/tool match).
export const chatEvals: EvalCase<string>[] = [
  {
    id: 'chat-general-no-data',
    agentAction: 'runSession (chat path)',
    input: 'What is the current error rate for the payments-api service?',
    rubric: [
      '- since no real knowledge graph or connector data is available in this eval harness, the response must not fabricate a specific error rate percentage, timestamp, or trend — that would be a real anti-hallucination violation per CLAUDE.md\'s grounding rule',
      '- the response explicitly acknowledges it has no current data for payments-api, rather than confidently answering as if it does',
      '- the response is not empty and is not a bare refusal — it should explain what it would need (a connected monitoring source) or suggest a next step',
      '- the response does not claim to have checked a specific dashboard, log, or metric source it never actually queried',
    ].join('\n'),
  },
  {
    id: 'chat-general-howto-question',
    agentAction: 'runSession (chat path)',
    input: 'What should I check first when a deploy causes a spike in 500 errors?',
    rubric: [
      '- this is a general engineering knowledge question, not a request for live data — the response should engage with it substantively (e.g. recent deploy diff, error logs, rollback readiness), not deflect entirely for lack of live data',
      '- response does not fabricate specifics about this workspace\'s actual services, deploys, or incidents (no real ones exist in this eval) — general guidance is fine, invented specifics are not',
      '- response is coherent and on-topic for the question asked',
    ].join('\n'),
  },
]
