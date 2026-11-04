/**
 * Masks credentials in text-like attachments (device configs, logs, diagnostic bundles) before
 * engineers or other customer users see them. Rules target the configuration grammars of network
 * devices (password/secret/community/key/PSK statements), PEM private keys and common API tokens.
 * Conservative by design: masking a non-secret is harmless; leaking a secret is not.
 */
export interface MaskResult {
  text: string;
  count: number;
  rules: Record<string, number>;
}

const MASK = '******';

interface Rule {
  id: string;
  re: RegExp;
  /** index of the capture group holding the secret */
  group: number;
}

const KEYWORD_VALUE: Rule[] = [
  // password / secret statements, incl. "password 7 <hash>", "secret 5 $1$..", "password cipher <x>", "password simple <x>"
  {
    id: 'password',
    re: /\b((?:enable\s+)?(?:password|passwd|secret|passphrase)(?:\s+(?:0|5|7|8|9|cipher|simple|irreversible-cipher|hash|encrypted|plain))?\s+)(\S+)/gi,
    group: 2,
  },
  {
    id: 'password-kv',
    re: /\b((?:password|passwd|pwd|secret|passphrase)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    group: 2,
  },
  // SNMP communities: "snmp-server community <x> RO", "snmp-agent community read <x>", "community <x>"
  {
    id: 'snmp-community',
    re: /\b(community(?:\s+(?:read|write|ro|rw|cipher|simple))*\s+)(\S+)/gi,
    group: 2,
  },
  // pre-shared keys and generic key statements
  {
    id: 'psk',
    re: /\b((?:pre-shared-key|preshared-key|psk|wpa-psk|wpa2-psk|sae-password)(?:\s+(?:0|7|cipher|simple|ascii|hex|pass-phrase|raw-key))*\s+)(\S+)/gi,
    group: 2,
  },
  {
    id: 'key',
    re: /\b((?:key-string|authentication-key|auth-key|md5|sha|hmac-sha-256|radius-server\s+key|tacacs-server\s+key|key)(?:\s+(?:0|7|cipher|simple))*\s+)(\S+)/gi,
    group: 2,
  },
  {
    id: 'snmpv3-auth',
    re: /\b((?:auth|priv)(?:entication|acy)?-?(?:mode)?\s+(?:md5|sha|sha256|des|aes\d*)\s+(?:cipher\s+|simple\s+)?)(\S+)/gi,
    group: 2,
  },
  // tokens in key=value form
  {
    id: 'token-kv',
    re: /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|bearer)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    group: 2,
  },
];

const WHOLE: Array<{ id: string; re: RegExp }> = [
  {
    id: 'pem-private-key',
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
];

// Values that are not secrets even after a keyword (e.g. "password-policy enable", "key chain NAME").
const BENIGN =
  /^(?:\*+|enable|disable|required|optional|none|chain|config-key|policy|recovery|length|min-length|history|aging|level|\{|\(|<masked>)$/i;

export function maskSecrets(input: string): MaskResult {
  const rules: Record<string, number> = {};
  let count = 0;
  let text = input;
  for (const { id, re } of WHOLE) {
    text = text.replace(re, () => {
      count++;
      rules[id] = (rules[id] ?? 0) + 1;
      return `[${id} masked]`;
    });
  }
  for (const r of KEYWORD_VALUE) {
    text = text.replace(r.re, (...m: string[]) => {
      const secret = m[r.group]!;
      if (BENIGN.test(secret) || secret === MASK) return m[0]!;
      count++;
      rules[r.id] = (rules[r.id] ?? 0) + 1;
      return `${m[1]}${MASK}`;
    });
  }
  return { text, count, rules };
}

const TEXT_EXT = /\.(?:txt|log|cfg|conf|config|cnf|ini|diag|out|csv|json|xml|yaml|yml|tsv|har)$/i;
/** Text-like by extension AND content (no NUL bytes in the first 8 KiB). */
export function isTextLike(fileName: string, head: Buffer): boolean {
  return TEXT_EXT.test(fileName) && !head.subarray(0, 8192).includes(0);
}
