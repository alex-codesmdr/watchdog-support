import { createServer, type Server } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClamAvScanner } from './clamav.js';

/** Fake clamd: decodes INSTREAM chunks and answers FOUND when the payload contains "EICAR". */
let server: Server;
let port = 0;
beforeAll(async () => {
  server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    let body = Buffer.alloc(0);
    let headerSeen = false;
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!headerSeen) {
        const z = buf.indexOf(0);
        if (z < 0) return;
        headerSeen = true;
        buf = buf.subarray(z + 1);
      }
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n === 0) {
          sock.end(
            body.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
          );
          return;
        }
        if (buf.length < 4 + n) return;
        body = Buffer.concat([body, buf.subarray(4, 4 + n)]);
        buf = buf.subarray(4 + n);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('ClamAvScanner', () => {
  it('scans a small stream that the caller is already reading (hash listener)', async () => {
    const src = Readable.from([Buffer.from('hostname core\n')]);
    let seen = 0;
    src.on('data', (c: Buffer) => (seen += c.length));
    const r = await new ClamAvScanner('127.0.0.1', port, 2_000).scan(src);
    expect(r).toEqual({ clean: true });
    expect(seen).toBe(14);
  });

  it('reports a signature', async () => {
    const src = new PassThrough();
    src.end('X5O!P%@AP EICAR test');
    const r = await new ClamAvScanner('127.0.0.1', port, 2_000).scan(src);
    expect(r).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
  });

  it('fails closed when clamd is unreachable', async () => {
    await expect(
      new ClamAvScanner('127.0.0.1', 1, 1_000).scan(Readable.from([Buffer.from('x')])),
    ).rejects.toThrow();
  });
});
