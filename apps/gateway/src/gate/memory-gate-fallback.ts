import { InMemoryGateSink } from '@anway/agent'

let _sink: InMemoryGateSink | null = null

export function getMemoryGateSink(): InMemoryGateSink {
  if (!_sink) _sink = new InMemoryGateSink()
  return _sink
}
