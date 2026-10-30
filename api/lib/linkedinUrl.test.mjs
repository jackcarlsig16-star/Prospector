// node --test api/lib/linkedinUrl.test.mjs
// FIX linkedin-url-normalize - the shared LinkedIn link rule. Invented handles; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLinkedinUrl as n } from './linkedinUrl.js';

test('accepted the way people paste it, stored as one clean https://www.linkedin.com link', () => {
  const cases = [
    ['linkedin.com/in/zz-test-handle', 'https://www.linkedin.com/in/zz-test-handle'],
    ['www.linkedin.com/in/zz-test-handle', 'https://www.linkedin.com/in/zz-test-handle'],
    ['LinkedIn.com/in/zz-test-handle/', 'https://www.linkedin.com/in/zz-test-handle'],
    ['http://linkedin.com/in/zz-test-handle', 'https://www.linkedin.com/in/zz-test-handle'],
    ['https://www.linkedin.com/in/zz-test-handle/?trk=public_profile#about', 'https://www.linkedin.com/in/zz-test-handle'],
    ['uk.linkedin.com/in/zz-test-handle', 'https://www.linkedin.com/in/zz-test-handle'],
    ['<https://www.linkedin.com/in/zz-test-handle>', 'https://www.linkedin.com/in/zz-test-handle'],
    ['  "linkedin.com/company/zz-test-co"  ', 'https://www.linkedin.com/company/zz-test-co'],
    ['//linkedin.com/pub/zz-test/1/2/3', 'https://www.linkedin.com/pub/zz-test/1/2/3'],
  ];
  for (const [raw, want] of cases) assert.equal(n(raw), want, raw);
});

test('anything that is not a LinkedIn link -> null', () => {
  for (const raw of ['notlinkedin.com/in/x', 'linkedin.com.evil.com/in/x', 'evil.com/linkedin.com/in/x', 'ftp://linkedin.com/in/x', 'linkedin.com', 'https://www.linkedin.com/', 'https://user:pw@linkedin.com/in/x', 'linkedin.com:8443/in/x', '', '   ', null, 42, `linkedin.com/in/${'x'.repeat(300)}`])
    assert.equal(n(raw), null, String(raw));
});
