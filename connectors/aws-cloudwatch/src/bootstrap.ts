import { execSync } from 'child_process'
import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

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

export class AwsCloudwatchBootstrap implements IConnectorBootstrap {
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

    // EC2 instances
    const ec2Data = runAws('ec2 describe-instances --query "Reservations[*].Instances[*]" --output json', env) as unknown[][][] | null
    if (Array.isArray(ec2Data)) {
      const instances = ec2Data.flat(2) as Array<{
        InstanceId: string; InstanceType: string; State: { Name: string };
        Tags?: Array<{ Key: string; Value: string }>;
        Placement?: { AvailabilityZone: string }
        CpuOptions?: { CoreCount: number }
      }>
      for (const inst of instances) {
        if (!inst.InstanceId) continue
        const nameTag = inst.Tags?.find(t => t.Key === 'Name')?.Value
        const name = nameTag ?? inst.InstanceId
        const az = inst.Placement?.AvailabilityZone ?? region
        const status = inst.State?.Name === 'running' ? 'healthy' : inst.State?.Name === 'stopped' ? 'unknown' : 'warning'
        await this.kg.upsertEntity({
          type: 'CloudResource',
          name,
          metadata: {
            source: 'aws-cloudwatch',
            provider: 'aws',
            resourceType: 'EC2',
            resourceId: inst.InstanceId,
            instanceType: inst.InstanceType,
            region: az,
            status,
            connectorCoordinates: {
              'aws-cloudwatch': {
                connectorType: 'aws-cloudwatch',
                resourceIds: { instanceId: inst.InstanceId, region },
                resolvedAt: new Date().toISOString(),
                confidence: 1.0,
              },
            },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }

    // ECS clusters and services
    const ecsClusters = runAws('ecs list-clusters', env) as { clusterArns?: string[] } | null
    if (Array.isArray(ecsClusters?.clusterArns)) {
      for (const arn of ecsClusters.clusterArns) {
        const clusterName = arn.split('/').pop() ?? arn
        const servicesData = runAws(`ecs list-services --cluster ${arn}`, env) as { serviceArns?: string[] } | null
        if (Array.isArray(servicesData?.serviceArns)) {
          for (const svcArn of servicesData.serviceArns) {
            const svcName = svcArn.split('/').pop() ?? svcArn
            await this.kg.upsertEntity({
              type: 'CloudResource',
              name: svcName,
              metadata: {
                source: 'aws-cloudwatch',
                provider: 'aws',
                resourceType: 'ECS Service',
                resourceId: svcArn,
                cluster: clusterName,
                region,
                status: 'healthy',
                connectorCoordinates: {
                  'aws-cloudwatch': {
                    connectorType: 'aws-cloudwatch',
                    resourceIds: { serviceArn: svcArn, cluster: clusterName, region },
                    resolvedAt: new Date().toISOString(),
                    confidence: 1.0,
                  },
                },
              },
            }, tenantId)
            entitiesUpserted++
          }
        }
      }
    }

    // CloudWatch alarms
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
            source: 'aws-cloudwatch',
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
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: [`AWS CloudWatch bootstrap: ${entitiesUpserted} resources/alarms discovered in ${region}`],
    }
  }
}
