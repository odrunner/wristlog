import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// SES click tracking rewrites every email href to https://click.wrotate.com/…
// iOS matches Universal Links on that INITIAL host and hands the wrapper to the
// app without ever making a network request. So two things must hold for
// "opens the app" AND "counts the click" to both be true:
//   1. the app must recognise every wrapper shape SES produces and unwrap it
//      before routing (else a deep link to /p/123 degrades to a plain load);
//   2. the app must fire the tracking URL itself, or the click is never recorded.
// Source assertions because this repo has no Xcode; they guard the contract
// between the SES link format, the AASA on click.wrotate.com and ContentView.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const contentView = read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift');
const entitlements = read('ios', 'Wrotate', 'Wrotate', 'Wrotate.entitlements');
const aasa = JSON.parse(
  read('infra', 'click-tracking', 'assets', '.well-known', 'apple-app-site-association'),
);

// Mirror of unwrapTrackedLink()'s segment logic — kept in lockstep by the
// source assertions below, and exercised here against every documented shape.
function unwrap(urlString) {
  const u = new URL(urlString);
  const segments = u.pathname.split('/').filter(Boolean);
  const destIndex = { L0: 1, CL0: 1, CL1: 2 }[segments[0]];
  if (destIndex === undefined || segments.length <= destIndex) return null;
  const decoded = decodeURIComponent(segments[destIndex]);
  if (!/^https?:\/\//.test(decoded)) return null;
  return decoded;
}

const enc = encodeURIComponent('https://wrotate.com/p/123?id=123');

describe('tracked link shapes', () => {
  it('unwraps the awstrack default shape (/L0/)', () => {
    expect(unwrap(`https://click.wrotate.com/L0/${enc}/1/0100abc/hash=`)).toBe(
      'https://wrotate.com/p/123?id=123',
    );
  });
  it('unwraps the custom-redirect-domain shape (/CL0/)', () => {
    expect(unwrap(`https://click.wrotate.com/CL0/${enc}/1/0100abc/hash=`)).toBe(
      'https://wrotate.com/p/123?id=123',
    );
  });
  it('unwraps the ses:custom-path shape (/CL1/<seg>/)', () => {
    expect(unwrap(`https://click.wrotate.com/CL1/wrotate/${enc}/1/0100abc/hash=`)).toBe(
      'https://wrotate.com/p/123?id=123',
    );
  });
  it('leaves non-wrapper URLs alone', () => {
    expect(unwrap('https://wrotate.com/p/123?id=123')).toBeNull();
    expect(unwrap('https://click.wrotate.com/I0/pixel.gif')).toBeNull();
    expect(unwrap(`https://click.wrotate.com/CL1/${enc}/1/x/y`)).toBeNull(); // CL1 needs the path seg
  });
});

describe('ContentView.swift — native side of the contract', () => {
  it('recognises all three SES wrapper markers', () => {
    expect(contentView).toMatch(/case "L0", "CL0"/);
    expect(contentView).toMatch(/case "CL1"/);
  });

  it('reads the percent-encoded path (pathComponents would decode %2F)', () => {
    expect(contentView).toMatch(/\.percentEncodedPath/);
  });

  it('fires the tracking URL when a wrapper is opened, so the click is recorded', () => {
    expect(contentView).toMatch(/recordTrackedClick\(url\)/);
    expect(contentView).toMatch(/private func recordTrackedClick\(_ url: URL\)/);
  });

  it('does not follow the 302 (routing already used the unwrapped destination)', () => {
    expect(contentView).toMatch(/willPerformHTTPRedirection/);
    expect(contentView).toMatch(/completionHandler\(nil\)/);
  });

  it('only pings our own tracking host', () => {
    expect(contentView).toMatch(/host == "click\.wrotate\.com"/);
  });
});

describe('AASA on click.wrotate.com ↔ entitlement', () => {
  it('app associates the tracking host', () => {
    expect(entitlements).toMatch(/applinks:click\.wrotate\.com/);
  });

  it('AASA names the app and covers every wrapper shape', () => {
    const d = aasa.applinks.details[0];
    expect(d.appIDs).toEqual(['JSNK92LRFD.com.wrotate.Wrotate']);
    const paths = d.components.map((c) => c['/']);
    expect(paths).toEqual(expect.arrayContaining(['/L0/*', '/CL0/*', '/CL1/*']));
  });
});
