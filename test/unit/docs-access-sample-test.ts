// @ts-nocheck
/**
 * SCAFFOLD — abofs/stonyx-orm#265 AC-5
 *
 * docs/usage-patterns.md carries a second copy of the access() sample. It is
 * NOT in the published tarball (`docs/` does not ship), so it is a lower-
 * severity sibling of README.md:325 — but it is on the repo's GitHub page,
 * which is how a consumer of a private-registry package actually reads docs.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] docs access() sample — #265 AC-5', function() {
  test('TODO: docs/usage-patterns.md contains no mount-relative request.url predicate', function(assert) {
    assert.ok(true, 'TODO');
  });
});
