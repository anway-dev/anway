import { createServer, IncomingMessage, ServerResponse } from 'http'

export interface FixtureRoute {
  method: string
  path: string  // exact match or prefix (if ends with *)
  status: number
  body: unknown
  assertHeaders?: (headers: Record<string, string | string[] | undefined>) => void
}

export interface FixtureServer {
  baseUrl: string
  receivedRequests: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string }>
  close: () => Promise<void>
}

export async function startFixtureServer(routes: FixtureRoute[]): Promise<FixtureServer> {
  const received: FixtureServer['receivedRequests'] = []

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      const method = req.method ?? 'GET'
      const path = req.url ?? '/'
      received.push({ method, path, headers: req.headers as Record<string, string | string[] | undefined>, body })

      const pathOnly = path.split('?')[0]!
      const route = routes.find(r =>
        r.method === method &&
        (r.path.endsWith('*') ? pathOnly.startsWith(r.path.slice(0, -1)) : pathOnly === r.path)
      )
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `fixture: no route for ${method} ${path}` }))
        return
      }
      if (route.assertHeaders) route.assertHeaders(req.headers as Record<string, string | string[] | undefined>)
      res.writeHead(route.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(route.body))
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    receivedRequests: received,
    close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())),
  }
}
