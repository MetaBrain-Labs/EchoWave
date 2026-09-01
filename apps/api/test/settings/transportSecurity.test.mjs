/**
 * Credential 传输安全矩阵测试。
 *
 * 覆盖 HTTPS、真实 localhost、可信代理和伪造转发头。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyTransport, isTrustedProxy } from '../../dist/settings/transportSecurity.js';

describe('Credential transport security', () => {
  it('allows direct HTTPS and real loopback HTTP', () => {
    assert.equal(
      classifyTransport({
        protocol: 'https:',
        host: 'api.example.com',
        remoteAddress: '203.0.113.8',
        trustedProxyCidrs: [],
      }).mode,
      'https',
    );
    assert.equal(
      classifyTransport({
        protocol: 'http:',
        host: 'localhost:3001',
        remoteAddress: '::1',
        trustedProxyCidrs: [],
      }).mode,
      'localhost',
    );
  });

  it('allows forwarded HTTPS only from an explicitly trusted proxy', () => {
    const trusted = classifyTransport({
      protocol: 'http:',
      host: 'api.example.com',
      remoteAddress: '10.20.1.9',
      forwardedProto: 'https',
      trustedProxyCidrs: ['10.20.0.0/16'],
    });
    const spoofed = classifyTransport({
      protocol: 'http:',
      host: 'api.example.com',
      remoteAddress: '203.0.113.8',
      forwardedProto: 'https',
      trustedProxyCidrs: ['10.20.0.0/16'],
    });
    assert.equal(trusted.mode, 'trusted_proxy_https');
    assert.equal(trusted.secretSubmissionAllowed, true);
    assert.equal(spoofed.mode, 'insecure_remote_http');
    assert.equal(spoofed.secretSubmissionAllowed, false);
    assert.equal(
      classifyTransport({
        protocol: 'http:',
        host: 'api.example.com',
        remoteAddress: '10.20.1.9',
        forwardedProto: 'http',
        trustedProxyCidrs: ['10.20.0.0/16'],
      }).mode,
      'insecure_remote_http',
    );
  });

  it('supports strict IPv4 and IPv6 CIDR matching', () => {
    assert.equal(isTrustedProxy('192.168.10.5', ['192.168.10.0/24']), true);
    assert.equal(isTrustedProxy('192.168.11.5', ['192.168.10.0/24']), false);
    assert.equal(isTrustedProxy('2001:db8::5', ['2001:db8::/32']), true);
    assert.equal(isTrustedProxy('2001:db9::5', ['2001:db8::/32']), false);
    assert.throws(() => isTrustedProxy('127.0.0.1', ['127.0.0.1/40']));
  });

  it('does not treat a remote Host as localhost through a loopback proxy', () => {
    assert.equal(
      classifyTransport({
        protocol: 'http:',
        host: '192.168.1.20:3001',
        remoteAddress: '127.0.0.1',
        forwardedProto: 'http',
        trustedProxyCidrs: ['127.0.0.1/32'],
      }).mode,
      'insecure_remote_http',
    );
  });
});
