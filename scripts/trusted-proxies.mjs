import { isIP } from 'node:net';

export function parseTrustedProxies(value = '') {
  if (!value.trim()) return [];
  return [...new Set(value.split(',').map(entry => {
    const cidr = entry.trim();
    const [address, prefix, ...extra] = cidr.split('/');
    const version = isIP(address);
    if (!version || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('Trusted proxy entries must be IP addresses or valid IPv4/IPv6 CIDRs');
    }
    return cidr;
  }))];
}
