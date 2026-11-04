import { describe, expect, it } from 'vitest';
import { isTextLike, maskSecrets } from './secret-masker.js';

describe('maskSecrets', () => {
  it.each([
    ['enable secret 5 $1$abcd$Q1w2e3r4', 'enable secret 5 ******'],
    ['username admin password 7 0822455D0A16', 'username admin password 7 ******'],
    ['local-user admin password cipher $c$3$HGu8xy==', 'local-user admin password cipher ******'],
    ['snmp-server community Publ1cR0 RO', 'snmp-server community ****** RO'],
    ['snmp-agent community read cipher Xy12abc', 'snmp-agent community read cipher ******'],
    ['crypto isakmp key MyPSK123 address 10.0.0.1', 'crypto isakmp key ****** address 10.0.0.1'],
    [' pre-shared-key cipher Abc$123', ' pre-shared-key cipher ******'],
    ['wpa-psk ascii SuperSecretWifi', 'wpa-psk ascii ******'],
    ['radius-server key R4d1us!', 'radius-server key ******'],
    ['api_key=sk_live_123456', 'api_key=******'],
    ['PASSWORD: "hunter 2"', 'PASSWORD: ******'],
  ])('%s', (input, expected) => {
    const r = maskSecrets(input);
    expect(r.text).toBe(expected);
    expect(r.count).toBe(1);
  });

  it('leaves benign statements and normal log lines alone', () => {
    const lines = ['password-recovery enable', 'key chain CORE', 'interface GigabitEthernet1/0/1', 'Link up at 10:02:11', 'password policy enable'];
    for (const l of lines) expect(maskSecrets(l).count).toBe(0);
  });

  it('masks PEM private keys and AWS keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOg\n-----END RSA PRIVATE KEY-----';
    const r = maskSecrets(`a\n${pem}\nAKIAABCDEFGHIJKLMNOP`);
    expect(r.text).not.toContain('MIIBOg');
    expect(r.text).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(r.rules).toMatchObject({ 'pem-private-key': 1, 'aws-access-key': 1 });
  });

  it('detects text-like files', () => {
    expect(isTextLike('running.cfg', Buffer.from('hostname core'))).toBe(true);
    expect(isTextLike('capture.pcap', Buffer.from('x'))).toBe(false);
    expect(isTextLike('fake.log', Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBe(false);
  });
});
