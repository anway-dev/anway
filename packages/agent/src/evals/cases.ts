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
