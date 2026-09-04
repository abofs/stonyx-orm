// @ts-nocheck
/**
 * Every access() sample that reaches a consumer — abofs/stonyx-orm#265.
 *
 * The behavioural measurement of the README sample lives in
 * test/integration/readme-access/, which boots a server on those exact bytes.
 * This file covers the two things that measurement cannot see:
 *
 *  1. The population. `test/sample/` is not in the tarball and `README.md` is,
 *    so the file set is enumerated from `npm pack --dry-run` rather than from a
 *    grep of the working tree — a sample added to a second packed document
 *    would otherwise ship unmeasured, which is exactly how this shipped.
 *
 *  2. The contract. `access()` takes one argument on this line; the four-argument
 *     form is abofs/stonyx-orm#202's and stays reverted. A sample documenting it
 *     would not run.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { findAccessSamples } from './readme-access/extract-sample.ts';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);

/** Properties that carry the client's raw URL text. None is safe to authorize on. */
const URL_PROPERTIES = /\b(?:request|req)\.(?:url|originalUrl|baseUrl|path)\b/;

/** Files npm would put in the tarball, straight from npm's own enumeration. */
async function packedFiles() {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });

  return JSON.parse(stdout)[0].files.map(file => file.path);
}

module('[Docs] packed access() samples (#265)', function(hooks) {
  let packed;
  let samples;

  hooks.before(async function() {
    packed = await packedFiles();

    // Collect every access() sample from every packed markdown document.
    samples = [];

    for (const path of packed.filter(file => file.endsWith('.md'))) {
      const markdown = await readFile(path, 'utf8');
      for (const code of findAccessSamples(markdown)) samples.push({ path, code });
    }
  });

  test('the packed file set is what it claims to be', function(assert) {
    // Guards the checks below against passing vacuously on an empty enumeration.
    assert.ok(packed.length > 0, `npm pack enumerated ${packed.length} files`);
    assert.ok(packed.includes('README.md'), 'README.md is packed — consumers read it');
    assert.notOk(
      packed.some(file => file.startsWith('test/')),
      'nothing under test/ is packed — test/sample/ cannot serve as consumer documentation'
    );
  });

  test('at least one access() sample is packed', function(assert) {
    // The two assertions below are satisfied by an empty sample list; this is
    // the control that says there was something to check.
    assert.ok(samples.length > 0, `found ${samples.length} packed access() sample(s)`);
  });

  test('no packed access() sample authorizes on a request URL', function(assert) {
    for (const { path, code } of samples) {
      const offending = code.split('\n').filter(line => URL_PROPERTIES.test(line));

      assert.deepEqual(
        offending,
        [],
        `${path}: sample must not read a URL property — request.url is mount-relative and originalUrl is raw client text`
      );
    }
  });

  test('every packed access() sample declares the one-argument contract', function(assert) {
    for (const { path, code } of samples) {
      const signature = code.match(/\baccess\s*\(([^)]*)\)/);

      assert.ok(signature, `${path}: sample declares an access() method`);

      const parameters = signature[1].split(',').map(part => part.trim()).filter(Boolean);

      assert.deepEqual(
        parameters.length,
        1,
        `${path}: access() takes exactly one argument — got (${signature[1]})`
      );
    }
  });
});
