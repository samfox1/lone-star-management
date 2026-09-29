/**
 * A real web server on this machine, used as a witness by the safe-fetching tests.
 *
 * Code:     none (a test helper); serves tests/unit/safe-fetching/*.test.ts
 * Feature:  safe fetching (every server fetch of an outside address)
 * Tier:     STRICT (AGENTS.md "Test depth"): the files that use it are security tests.
 * What it provides:
 *           • one http server on 127.0.0.1, on a free port, per test file
 *           • a count of connections: "refused" in a test then means no socket reached the
 *             server, not merely that a promise rejected
 *           • the last request it got (method, Host header, headers, body)
 *           • a few fixed answers: /redirect (302 to evil.example), /gzip, /deflate, /br,
 *             /weird-encoding (an encoding nobody knows), /empty (204), /slow (sends a
 *             little, then never finishes); anything else is a small html page with an
 *             X-Thing header
 * Not here: no DNS. The tests hand the safe transport a fake resolver (tests/helpers/fake-dns.ts)
 *           that points a name at 127.0.0.1, and `allowLoopback` (tests only) lets it connect.
 * Fixtures: real node:http, real zlib; nothing leaves the machine.
 */
import http from 'node:http'
import type net from 'node:net'
import zlib from 'node:zlib'

export type LastRequest = { method?: string; host?: string; body: string; headers: http.IncomingHttpHeaders }

export type LoopbackServer = {
  port: number
  /** How many connections have reached the server so far. */
  connections: () => number
  lastRequest: () => LastRequest | null
  close: () => Promise<void>
}

export async function startLoopbackServer(): Promise<LoopbackServer> {
  let connections = 0
  let last: LastRequest | null = null
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      last = { method: req.method, host: req.headers.host, body, headers: req.headers }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://evil.example/' })
        res.end('moved')
      } else if (req.url === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
        res.end(zlib.gzipSync('hello, unzipped'))
      } else if (req.url === '/deflate') {
        res.writeHead(200, { 'content-encoding': 'deflate' })
        res.end(zlib.deflateSync('hello, inflated'))
      } else if (req.url === '/br') {
        res.writeHead(200, { 'content-encoding': 'br' })
        res.end(zlib.brotliCompressSync('hello, unbrotlied'))
      } else if (req.url === '/weird-encoding') {
        res.writeHead(200, { 'content-encoding': 'zstd-ish' })
        res.end('left as it came')
      } else if (req.url === '/empty') {
        res.writeHead(204)
        res.end()
      } else if (req.url === '/slow') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('first ')
        // …and never finishes.
      } else {
        res.writeHead(200, { 'content-type': 'text/html', 'X-Thing': 'yes' })
        res.end('<p>hi</p>')
      }
    })
  })
  server.on('connection', () => connections++)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    connections: () => connections,
    lastRequest: () => last,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
