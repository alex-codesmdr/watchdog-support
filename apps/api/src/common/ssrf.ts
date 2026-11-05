import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound URL policy for webhooks (threat T9). HTTPS only, no credentials in the URL, and every
 * resolved address must be public. The caller connects to the returned address (pinned), so a DNS
 * answer cannot change between this check and the request (rebinding).
 */
export class UnsafeUrlError extends Error {}

const v4 = (ip: string) => ip.split('.').map(Number) as [number, number, number, number];
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = v4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  const mapped =
    /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(x)) return true; // mapped, hex form: refuse
  const first = parseInt(x.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && x.startsWith('2001:db8')) // documentation
  );
}

export async function checkWebhookUrl(
  raw: string,
  allowPrivate: boolean,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Enter a full URL starting with https://');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
    throw new UnsafeUrlError('Webhook URLs must use https://');
  if (url.username || url.password) throw new UnsafeUrlError('Do not put credentials in the URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const answers = isIP(host)
    ? [{ address: host, family: isIP(host) as 4 | 6 }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new UnsafeUrlError('The host name does not resolve');
      });
  if (!answers.length) throw new UnsafeUrlError('The host name does not resolve');
  if (!allowPrivate && answers.some((a) => isPrivateAddress(a.address)))
    throw new UnsafeUrlError('Webhook URLs must point to a public internet address');
  const a = answers[0]!;
  return { url, address: a.address, family: a.family as 4 | 6 };
}
