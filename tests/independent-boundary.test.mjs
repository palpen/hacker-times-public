import test from 'node:test';
import assert from 'node:assert/strict';
import { independentRequestAllowed } from '../lib/independent-boundary.mjs';
test('independent preview rejects mutation and privileged routes', () => {
  for (const path of ['/mcp', '/publishing', '/api/publish', '/api/rebuild', '/api/candidates', '/signin-with-chatgpt']) {
    assert.equal(independentRequestAllowed(new Request('https://example.test' + path)), false);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(independentRequestAllowed(new Request('https://example.test/', {method})), false);
});
test('reader routes remain available', () => {
  for (const path of ['/', '/api/edition', '/api/archive', '/api/comments', '/reader-assets/reader.css', '/reader-assets/masthead.woff2']) assert.equal(independentRequestAllowed(new Request('https://example.test' + path)), true);
});
