// @ts-nocheck
/**
 * Extracts the access() sample out of the shipped README.md — abofs/stonyx-orm#265.
 *
 * README.md is a packed file; test/sample/ is not. The two populations of
 * "the sample" diverged because nothing read the packed one. Everything that
 * asserts anything about the documented sample reads it through here, so the
 * bytes under test are the bytes a consumer copies.
 *
 * The scanner is deliberately tag-INDEPENDENT. The first version matched only
 * ```js, which is README.md's minority tag (12, against 18 ```javascript), and
 * a fail-open sample added under any other tag was invisible to all three
 * guards that read through this file. A guard that can only see the defect
 * spelled one way is not a guard, so this recognises every fence and decides
 * what is a sample by the code's SHAPE (see isAccessSample) rather than by the
 * label an author happened to type.
 *
 * Scanned line-by-line rather than by regex: a permissive one-regex form
 * mis-pairs the closing fence of a non-sample block with the opening fence of
 * the next one, and captures the prose between them.
 */
import { readFile } from 'node:fs/promises';

/** Opens or closes a fenced block: three-or-more backticks/tildes, optional info string. */
const FENCE_LINE = /^(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;

/** The block is identified by its shape, not by a line number that drifts. */
function isAccessSample(code) {
  return /\bmodels\s*=/.test(code) && /\baccess\s*\(/.test(code);
}

/**
 * Every fenced code block in a markdown document, in document order, whatever
 * the info string says — including none at all.
 */
function findFencedBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);

  let opener = null;
  let body = null;

  for (const line of lines) {
    const fence = FENCE_LINE.exec(line);

    if (!opener) {
      // A fence line outside a block opens one. Its info string is ignored:
      // deciding by tag is precisely the defect this file exists to avoid.
      if (fence) {
        opener = fence[1];
        body = [];
      }

      continue;
    }

    // Inside a block: only a fence of the same character, at least as long as
    // the opener, closes it. Anything else — including a shorter run, or the
    // other fence character — is content.
    if (fence && fence[1][0] === opener[0] && fence[1].length >= opener.length && fence[2] === '') {
      blocks.push(body.join('\n'));
      opener = null;
      body = null;

      continue;
    }

    body.push(line);
  }

  // An unterminated fence at EOF is malformed markdown; take what it opened
  // rather than dropping it, so a truncated document cannot hide a sample.
  if (opener) blocks.push(body.join('\n'));

  return blocks;
}

/** Every access() sample in a markdown document, in document order. */
export function findAccessSamples(markdown) {
  return findFencedBlocks(markdown).filter(isAccessSample);
}

/**
 * Every access() sample in README.md, in document order.
 *
 * This used to throw unless there was exactly ONE. The intent was right — a
 * second, unmeasured sample is the defect #265 closes — but the remedy was to
 * forbid coverage rather than provide it, and it was load-bearing in the wrong
 * direction: an additive sample the extractor could not see left the count at 1
 * and the tripwire silent. Returning all of them, and having the harness boot
 * all of them, makes the guard additive-safe by construction instead of by the
 * breadth of a regex.
 *
 * Throws on zero: a README with no access() sample means the extractor stopped
 * matching, and every assertion downstream would pass vacuously.
 *
 * @param {string} [path]
 * @returns {Promise<Array<{ code: string, path: string, index: number }>>}
 */
export async function extractReadmeAccessSamples(path = './README.md') {
  const markdown = await readFile(path, 'utf8');
  const matches = findAccessSamples(markdown);

  if (matches.length === 0) {
    throw new Error(
      `Expected at least 1 access() sample in ${path}, found 0. ` +
      'Every documented access() sample must be driven by test/integration/readme-access.'
    );
  }

  return matches.map((code, index) => ({ code, path, index }));
}
