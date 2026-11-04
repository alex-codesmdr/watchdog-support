import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export interface AvResult {
  clean: boolean;
  signature?: string;
}
export interface AvScanner {
  scan(stream: Readable): Promise<AvResult>;
}

/** Minimal clamd INSTREAM client (no dependency). Fails closed on any protocol or network error. */
export class ClamAvScanner implements AvScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 120_000,
  ) {}

  scan(stream: Readable): Promise<AvResult> {
    return new Promise((resolve, reject) => {
      // The caller may already have a 'data' listener (hashing), which switches the stream to
      // flowing mode. Hold it until clamd is connected, or a small file is gone before we send it.
      stream.pause();
      const sock = connect({ host: this.host, port: this.port });
      let reply = '';
      const fail = (e: Error) => {
        sock.destroy();
        stream.destroy();
        reject(e);
      };
      sock.setTimeout(this.timeoutMs, () => fail(new Error('clamd timeout')));
      sock.on('error', fail);
      sock.on('data', (d) => (reply += d.toString()));
      sock.on('end', () => {
        const r = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(r)) resolve({ clean: true });
        else if (/FOUND$/.test(r))
          resolve({
            clean: false,
            signature: r.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, ''),
          });
        else reject(new Error(`clamd: unexpected reply "${r.slice(0, 120)}"`));
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        stream.on('data', (chunk: Buffer) => {
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          if (!sock.write(Buffer.concat([len, chunk]))) {
            stream.pause();
            sock.once('drain', () => stream.resume());
          }
        });
        stream.on('end', () => sock.write(Buffer.from([0, 0, 0, 0])));
        stream.on('error', fail);
        stream.resume();
      });
    });
  }
}

/** Dev/test only (config forbids it in production). Detects the EICAR test string so flows are testable. */
export class DevAvScanner implements AvScanner {
  async scan(stream: Readable): Promise<AvResult> {
    let tail = '';
    for await (const chunk of stream) {
      const s = tail + (chunk as Buffer).toString('latin1');
      if (s.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
        return { clean: false, signature: 'Eicar-Test-Signature' };
      tail = s.slice(-64);
    }
    return { clean: true };
  }
}
