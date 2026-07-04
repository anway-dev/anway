import { execSync } from 'child_process'
import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface AwsCredentials {
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  region?: string
}

function awsEnv(creds: AwsCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (creds.accessKeyId) env['AWS_ACCESS_KEY_ID'] = creds.accessKeyId
  if (creds.secretAccessKey) env['AWS_SECRET_ACCESS_KEY'] = creds.secretAccessKey
  if (creds.sessionToken) env['AWS_SESSION_TOKEN'] = creds.sessionToken
  env['AWS_DEFAULT_REGION'] = creds.region ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1'
  return env
}

function runAws(args: string, env: NodeJS.ProcessEnv): unknown {
  try {
    const out = execSync(`aws ${args} --output json`, { env, timeout: 30000 })
    return JSON.parse(out.toString())
  } catch {
    return null
  }
}

export class AwsHealthBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const creds: AwsCredentials = {
      accessKeyId:     (payload['accessKeyId']     ?? payload['access_key_id'])     as string | undefined,
      secretAccessKey: (payload['secretAccessKey'] ?? payload['secret_access_key']) as string | undefined,
      sessionToken:    (payload['sessionToken']    ?? payload['session_token'])     as string | undefined,
      region:          (payload['region'])                                           as string | undefined,
    }

    const env = awsEnv(creds)
    const region = env['AWS_DEFAULT_REGION'] ?? 'us-east-1'
    let entitiesUpserted = 0
    const hints: string[] = []

    // -- AWS Health events (core) --------------------------------------------
    // describe-events requires Business/Enterprise support plan.
    // Handle entitlement failure gracefully — return zero entities rather
    // than falling back to fake placeholders.
    const healthData = runAws('health describe-events', env) as {
      events?: Array<{
        arn?: string
        service?: string
        region?: string
        statusCode?: string
        eventTypeCode?: string
        eventTypeCategory?: string
        startTime?: string
        endTime?: string
        eventDescription?: { latestDescription?: string }
      }>
    } | null

    if (Array.isArray(healthData?.events)) {
      for (const evt of healthData.events!) {
        if (!evt.arn) continue
        const status = evt.statusCode === 'open' || evt.statusCode === 'upcoming'
          ? 'warning'
          : evt.statusCode === 'closed'
            ? 'healthy'
            : 'unknown'
        await this.kg.upsertEntity({
          type: 'Alert',
          name: evt.eventTypeCode ?? evt.arn,
          metadata: {
            source: 'aws-health',
            provider: 'aws',
            externalId: evt.arn,
            severity: evt.statusCode === 'open' ? 'high' : 'low',
            service: evt.service ?? 'Unknown',
            region: evt.region ?? 'global',
            status,
            statusCode: evt.statusCode,
            category: evt.eventTypeCategory,
            description: evt.eventDescription?.latestDescription ?? evt.eventTypeCode ?? 'AWS Health event',
            startTime: evt.startTime,
            endTime: evt.endTime,
            connectorCoordinates: {
              'aws-health': {
                connectorType: 'aws-health',
                resourceIds: { eventArn: evt.arn, region: evt.region ?? region },
                resolvedAt: new Date().toISOString(),
                confidence: 1.0,
              },
            },
          },
        }, tenantId)
        entitiesUpserted++
      }
      hints.push(`AWS Health: ${healthData.events.length} events discovered`)
    } else {
      hints.push(
        'AWS Health describe-events returned no data — ' +
        'account may not have Business/Enterprise support plan (required by AWS Health API). ' +
        'No health events seeded.'
      )
    }

    // -- CloudWatch alarms (health-relevant vital signs) ---------------------
    const alarmsData = runAws('cloudwatch describe-alarms --query "MetricAlarms[*]" --state-value ALARM', env) as Array<{
      AlarmName: string; StateValue: string; MetricName: string; Namespace: string; AlarmDescription?: string
    }> | null
    if (Array.isArray(alarmsData)) {
      for (const alarm of alarmsData) {
        if (!alarm.AlarmName) continue
        await this.kg.upsertEntity({
          type: 'Alert',
          name: alarm.AlarmName,
          metadata: {
            source: 'aws-health',
            provider: 'aws',
            externalId: alarm.AlarmName,
            severity: 'high',
            state: alarm.StateValue,
            metric: alarm.MetricName,
            namespace: alarm.Namespace,
            description: alarm.AlarmDescription ?? alarm.AlarmName,
            firedAt: new Date().toISOString(),
            region,
          },
        }, tenantId)
        entitiesUpserted++
      }
      hints.push(`AWS Health: ${alarmsData.length} CloudWatch alarms in ALARM state`)
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: hints.length > 0 ? hints : [`AWS Health bootstrap: 0 entities discovered in ${region}`],
    }
  }
}
