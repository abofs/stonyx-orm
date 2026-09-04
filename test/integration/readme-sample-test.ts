// @ts-nocheck
/**
 * abofs/stonyx-orm#265 — the shipped README access() sample fails open.
 *
 * The README sample and the tested sample in test/sample/access/ are two
 * populations that diverged and that nothing asserted agreed. This file exists
 * to make them one population and to measure the result through the public REST
 * surface rather than by eyeballing an identifier.
 *
 * Filename note: this file DOES match the main suite glob (test/**\/*-test.ts)
 * on purpose. The access classes the live server loads are the ones under
 * test/sample/access, and byte-identity with the README fence is what makes a
 * fetch against this server a measurement of the documented sample.
 *
 * Scaffold commit: stubs only. Every acceptance criterion has a stub below.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Integration] README access() sample (#265)', function() {
  module('AC-1: the documented sample is what the server runs', function() {
    test('TODO: the README access sample is byte-identical to the access class the test server loads', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: no packed file still documents a URL-string access predicate', function(assert) {
      assert.ok(true, 'TODO');
    });
  });

  module('AC-2: the protected record is protected (outcome, not identifier)', function() {
    test('TODO: GET /owners/angela returns 403', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: DELETE /owners/angela returns 403 and the record survives', function(assert) {
      assert.ok(true, 'TODO');
    });
  });

  module('AC-3: the seven measured bypass spellings', function() {
    test('TODO: ?filter[age]=36 does not leak angela from the collection', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: ?x=1 does not leak angela from the collection', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: /owners/ (trailing slash) does not leak angela from the collection', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: /OWNERS (upper case mount) does not leak angela from the collection', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: /OwNeRs/angela (mixed case mount) returns 403', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: /owners/angela/ (trailing slash on the record) returns 403', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: /owners/%61ngela (percent-encoded id) returns 403', function(assert) {
      assert.ok(true, 'TODO');
    });
  });

  module('AC-4: scope — the one-argument access() contract is unchanged', function() {
    test('TODO: the documented sample declares access(request) with exactly one parameter', function(assert) {
      assert.ok(true, 'TODO');
    });
  });
});
