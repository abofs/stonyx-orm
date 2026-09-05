// @ts-nocheck
/**
 * Extracts the access() sample out of the shipped README.md — abofs/stonyx-orm#265.
 *
 * README.md is a packed file; test/sample/ is not. The two populations of
 * "the sample" diverged because nothing read the packed one. Everything that
 * asserts anything about the documented sample reads it through here, so the
 * bytes under test are the bytes a consumer copies.
 *
 * The scanner is tag-INDEPENDENT. The first version matched only ```js, which
 * is README.md's minority tag (12 opening fences, against 19 ```javascript —
 * counted block-wise; a line-wise count of fence lines double-counts every
 * block's closer as an unlabelled opener), and a fail-open sample added under
 * any other tag was invisible to all three guards that read through this file.
 * A guard that can only see the defect spelled one way is not a guard, so the
 * info string is discarded and what counts as a sample is decided from the
 * code's SHAPE (see isAccessSample) rather than from the label an author typed.
 *
 * WHAT THIS DOES NOT DO. Tag-independent is not parser-equivalent. This
 * recognises a fence by matching FENCE_LINE against one line at a time, so what
 * it enumerates is "lines that look like fences", not "the fenced code blocks a
 * CommonMark parser finds". It has no block context: it does not know it is
 * inside a list, a blockquote, or an HTML block. Concretely, at this commit a
 * blockquote-prefixed fence (`> ```js`) renders as highlighted JS on GitHub —
 * measured against POST /markdown — and is invisible here, and a fence inside an
 * indented code block is scanned even though CommonMark would call it literal
 * text. The first is a hole; the second is deliberate over-scanning.
 *
 * The axis this DOES close is indentation, and only after two corrections:
 * column 0 only, then ` {0,3}`, now any leading whitespace. See FENCE_LINE.
 * Each correction was a spelling; none of them was the class. The class is
 * closed by reconciling this enumeration against a real CommonMark parser and
 * failing loudly on any divergence — abofs/stonyx-orm#279.
 *
 * Scanned line-by-line rather than by regex: a permissive one-regex form
 * mis-pairs the closing fence of a non-sample block with the opening fence of
 * the next one, and captures the prose between them.
 */
import { readFile } from 'node:fs/promises';

/**
 * Opens or closes a fenced block: ANY amount of leading whitespace,
 * three-or-more backticks/tildes, then an arbitrary info string.
 *
 * The info string is `(.*?)`, not `(\S*)`. A fence like ```js title="x" carries
 * a space, and a pattern that only accepts one word silently fails to recognise
 * it as an opener — after which its CLOSING fence is read as an opener and the
 * prose after it is captured as a code block. The sample vanishes from the
 * guard's view. That is the same class of hole as the ```js-only regex this
 * scanner replaced, one spelling over.
 *
 * The leading `[ \t]*` is the same class again, one axis over, and it has now
 * moved twice. CommonMark permits a fence opener to be indented up to three
 * spaces, so this was first anchored at column 0 (missed every indented fence),
 * then widened to ` {0,3}` (missed columns 4-6). Both were wrong for the same
 * reason: CommonMark's three-space allowance is measured from the CONTAINING
 * BLOCK, not from the document, and inside a list item the content column
 * shifts right. This scanner has no list context, so any document-level cap it
 * applies is a cap on the wrong quantity.
 *
 * Measured against GitHub's own POST /markdown (mode: gfm), a ```js fence
 * written as a step of a numbered list comes back as
 * `<div class="highlight highlight-source-js">` at 3, 4 and 6 spaces AND at one
 * leading tab. A code sample written as step 2 of a procedure is indented by
 * CONVENTION, so every one of those columns is reachable by ordinary authoring
 * rather than by intent. This repo already contains two such fences
 * (test/spike/RESULTS-166.md:83 and :90, both at three spaces).
 *
 * So the cap is gone: match any indent, and let isAccessSample decide. Over-
 * scanning is the safe direction. The cost is that a deeply-indented literal
 * code block — which CommonMark would call an indented code block, not a fence —
 * is also scanned; a literal block containing an access class is still code a
 * reader copies, so there is no false positive that costs anything. The cost of
 * under-scanning is a fail-open sample shipping in the tarball with every layer
 * green, which is what happened three rounds running.
 *
 * This closes the indentation axis. It does NOT close the class: a
 * blockquote-prefixed fence (`> ```js`) also renders as highlighted JS on
 * GitHub and is still invisible here. See abofs/stonyx-orm#279 — the terminus
 * for this class is reconciling block enumeration against a real CommonMark
 * parser, not another spelling added to this regex.
 *
 * Per CommonMark a CLOSING fence may not carry an info string, which is what
 * distinguishes the two below. A closer may carry its own indentation, which
 * need not match the opener's — so indentation is not compared, only stripped.
 */
const FENCE_LINE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/;

/**
 * Removes up to `width` leading whitespace characters, the way CommonMark strips
 * a fence's indent.
 *
 * Counts characters rather than columns, and accepts a tab as one unit, because
 * FENCE_LINE captures tabs too: a fence indented with a tab inside a list step
 * renders as highlighted JS on GitHub. A body line written in the same style as
 * its opener — which is how a list item is actually typed — loses exactly its
 * structural indent. A line indented less than the opener loses only what it
 * has.
 */
function stripIndent(line, width) {
  let removed = 0;

  while (removed < width && (line[removed] === ' ' || line[removed] === '\t')) removed += 1;

  return line.slice(removed);
}

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
  let indent = 0;
  let body = null;

  for (const line of lines) {
    const fence = FENCE_LINE.exec(line);

    if (!opener) {
      // A fence line outside a block opens one. Its info string is ignored:
      // deciding by tag is precisely the defect this file exists to avoid.
      if (fence) {
        opener = fence[2];
        indent = fence[1].length;
        body = [];
      }

      continue;
    }

    // Inside a block: only a fence of the same character, at least as long as
    // the opener, closes it. Anything else — including a shorter run, or the
    // other fence character — is content.
    if (fence && fence[2][0] === opener[0] && fence[2].length >= opener.length && fence[3] === '') {
      blocks.push(body.join('\n'));
      opener = null;
      indent = 0;
      body = null;

      continue;
    }

    // Strip the opener's indentation, per CommonMark. It is markdown structure,
    // not source: the harness writes these bytes to disk and boots them, so the
    // captured code must be the sample a reader would copy, not the sample plus
    // the list nesting it happened to be written inside. Lines indented less
    // than the opener lose only what they have.
    body.push(stripIndent(line, indent));
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
 * and the tripwire silent. Returning all of them lets a second DOCUMENTED
 * sample be measured instead of rejected.
 *
 * Additive safety is held by the STATIC guard, not by booting. Precisely: the
 * `PROBED_README_MODELS` pin and the two shape checks in
 * test/integration/readme-sample-test.ts fire on an added sample regardless of
 * where in README.md it appears. Booting every sample is order-DEPENDENT and
 * cannot carry the property on its own — measured: a duplicate-model sample
 * appended after the good one is 33/33 green, because src/setup-rest-server.ts
 * catches the "already been defined" throw into a log.error and the later class
 * is silently dropped; the same sample inserted before it fails 14.
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
