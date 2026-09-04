// @ts-nocheck
/**
 * Extracts the access() sample out of the shipped README.md — abofs/stonyx-orm#265.
 *
 * README.md is a packed file; test/sample/ is not. The two populations of
 * "the sample" diverged because nothing read the packed one. Everything that
 * asserts anything about the documented sample reads it through here, so the
 * bytes under test are the bytes a consumer copies.
 */
import { readFile } from 'node:fs/promises';

const FENCE = /^```js\r?\n([\s\S]*?)^```/gm;

/** The block is identified by its shape, not by a line number that drifts. */
function isAccessSample(code) {
  return /\bmodels\s*=/.test(code) && /\baccess\s*\(/.test(code);
}

/** Every access() sample in a markdown document, in document order. */
export function findAccessSamples(markdown) {
  return [...markdown.matchAll(FENCE)].map(m => m[1]).filter(isAccessSample);
}

/**
 * @returns {Promise<{ code: string, path: string }>} the single access() sample
 *   in README.md. Throws if there is not exactly one — a second one would be a
 *   second population, which is the defect this issue closes.
 */
export async function extractReadmeAccessSample(path = './README.md') {
  const markdown = await readFile(path, 'utf8');
  const matches = findAccessSamples(markdown);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly 1 access() sample in ${path}, found ${matches.length}. ` +
      'Every documented access() sample must be driven by test/integration/readme-access.'
    );
  }

  return { code: matches[0], path };
}
