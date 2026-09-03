// @ts-nocheck
/**
 * JSON API links at a non-default REST mount — abofs/stonyx-orm#254
 *
 * Filename note: this file deliberately does NOT end in `-test.ts`. The main
 * suite's glob is `test/**\/*-test.ts`; if this file matched it, the module
 * would boot inside the default-route process, seed records into the shared
 * store and break `orm-test.ts`. It is run by its own QUnit process via the
 * `test:mounted` script, chained once per route in `pnpm test`.
 *
 * The mount route is a boot-time global (Stonyx is a singleton), so each row of
 * the AC3 route matrix is a separate process selected by ORM_TEST_ROUTE.
 */
import QUnit from 'qunit';
import { createRecord } from '@stonyx/orm';
import RestServer from '@stonyx/rest-server';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import { readFile, writeFile } from 'node:fs/promises';
import { raw, serialized } from '../../sample/payload.js';

const { module, test } = QUnit;

const ROUTE = process.env.ORM_TEST_ROUTE ?? '/api';
const GOLDEN_PATH = './test/sample/links-golden.json';

/**
 * Harness-declared mount per configured route. This is an explicit literal
 * table, NOT a re-implementation of the normaliser in setup-rest-server.ts —
 * a re-implementation would let the expectation share whatever assumption
 * produced the bug. AC3 validates each value by issuing a request at it and
 * requiring 200 before anything else treats it as an expectation.
 *
 * '/api/' is deliberately absent: it is *discovered* by probing (AC5).
 */
const DECLARED_MOUNT = {
  '/': '',
  '/api': '/api',
  'api': '/api',
  '/api/v1': '/api/v1',
};

/** Probed when the configured route has no declared mount (AC5). */
const PROBE_CANDIDATES = ['/api', '/api/'];

/**
 * Endpoint list for the AC4 golden fixture. Fixed, ordered, and covering all
 * six link emission sites at the default route.
 */
const GOLDEN_ENDPOINTS = [
  '/animals',
  '/animals/1',
  '/animals/2?include=owner',
  '/animals/1/owner',
  '/animals/1/relationships/owner',
  '/animals/1/traits',
  '/animals/1/relationships/traits',
  '/owners',
  '/owners/bob',
  '/owners/bob/pets',
  '/owners/bob/relationships/pets',
  '/traits/1',
  '/traits/1/relationships/category',
  '/categories',
  '/phone-numbers',
];

let origin;
let mount;

/** Fetch the URL the payload published and require it to answer 200. */
async function follow(assert, url, label) {
  assert.ok(typeof url === 'string' && /^https?:\/\//.test(url), `${label}: absolute URL — got ${url}`);

  const response = await fetch(url);
  assert.equal(response.status, 200, `${label}: GET ${url} -> 200`);

  if (response.status !== 200) return null;
  return response.json();
}

module(`[Integration] Mounted-route JSON API links (ORM_TEST_ROUTE="${ROUTE}")`, function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(async function() {
    origin = `http://localhost:${config.restServer.port}`;

    // Fresh process, empty store — seed the full sample dataset.
    for (const category of serialized.categories) createRecord('category', category);
    for (const trait of serialized.traits) createRecord('trait', trait);
    for (const phoneNumber of serialized.phoneNumbers) createRecord('phone-number', phoneNumber);
    for (const owner of raw.owners) createRecord('owner', owner);
    for (const animal of raw.animals) createRecord('animal', animal);

    if (ROUTE in DECLARED_MOUNT) {
      mount = DECLARED_MOUNT[ROUTE];
    } else {
      // AC5: discover the real mount rather than assuming a normalisation.
      for (const candidate of PROBE_CANDIDATES) {
        const response = await fetch(`${origin}${candidate}/animals`);
        if (response.status === 200) {
          mount = candidate;
          break;
        }
      }
    }
  });

  hooks.after(function() {
    try { RestServer.close(); } catch { /* force-exit hook handles the rest */ }
  });

  // ==========================================================================
  // AC1 — every advertised link is followable at a non-default mount
  // ==========================================================================
  module('AC1 — advertised links are followable', function() {
    test('all 10 link values from the 6 emission sites return 200 and identify the claimed resource', async function(assert) {
      // --- collection response: sites 1 (orm-request.ts getCollectionHandler),
      //     5 (record.ts toJSON resource links), 6 (record.ts toJSON relationship links)
      const collectionUrl = `${origin}${mount}/animals`;
      const collectionResponse = await fetch(collectionUrl);
      assert.equal(collectionResponse.status, 200, `collection route reachable at ${collectionUrl}`);
      const collection = await collectionResponse.json();

      // (1) document links.self (collection) — orm-request.ts getCollectionHandler
      const doc1 = await follow(assert, collection.links.self, '(1) document links.self (collection)');
      assert.ok(Array.isArray(doc1?.data), '(1) followed URL returns a collection');
      assert.strictEqual(doc1?.links?.self, collection.links.self, '(1) fixed point: refetched document republishes the same self link');

      // The access fixture filters angela's animals out of the collection; pick a
      // resource whose owner linkage is present so the relationship links resolve.
      const resource = collection.data.find(r => r?.relationships?.owner?.data?.id);
      assert.ok(resource, 'collection contains a resource with an owner linkage');

      // (2) resource links.self inside a collection — record.ts toJSON, resource links
      const doc2 = await follow(assert, resource.links.self, '(2) resource links.self (in collection)');
      assert.strictEqual(doc2?.data?.type, resource.type, '(2) followed URL returns the claimed type');
      assert.strictEqual(String(doc2?.data?.id), String(resource.id), '(2) followed URL returns the claimed id');

      const relationship = resource.relationships.owner;

      // (3) relationship links.self inside a collection — record.ts toJSON, relationship links.self
      const doc3 = await follow(assert, relationship.links.self, '(3) relationship links.self (in collection)');
      assert.strictEqual(doc3?.links?.self, relationship.links.self, '(3) fixed point on the linkage route');

      // (4) relationship links.related inside a collection — record.ts toJSON, relationship links.related
      const doc4 = await follow(assert, relationship.links.related, '(4) relationship links.related (in collection)');
      assert.strictEqual(doc4?.links?.self, relationship.links.related, '(4) related route republishes the URL as its self link');

      // --- single resource: sites 2 (orm-request.ts getSingleHandler) and
      //     5 (record.ts toJSON resource links)
      const singleResponse = await fetch(`${origin}${mount}/animals/1`);
      assert.equal(singleResponse.status, 200, 'single resource route reachable');
      const single = await singleResponse.json();

      // (5) document links.self (single) — orm-request.ts getSingleHandler
      const doc5 = await follow(assert, single.links.self, '(5) document links.self (single)');
      assert.strictEqual(doc5?.links?.self, single.links.self, '(5) fixed point');
      assert.strictEqual(String(doc5?.data?.id), '1', '(5) followed URL returns animal 1');

      // (6) resource links.self (single) — record.ts toJSON, resource links
      const doc6 = await follow(assert, single.data.links.self, '(6) resource links.self (single)');
      assert.strictEqual(doc6?.data?.type, 'animal', '(6) followed URL returns the claimed type');
      assert.strictEqual(String(doc6?.data?.id), '1', '(6) followed URL returns the claimed id');

      // (7) included resource links.self — orm-request.ts buildResponse (included mapping)
      //     -> record.ts toJSON, resource links
      // Animal 2 (owner michael), not animal 1: test/sample/access/global-access.ts
      // denies /owners/angela, and animal 1's owner is angela.
      const includeResponse = await fetch(`${origin}${mount}/animals/2?include=owner`);
      assert.equal(includeResponse.status, 200, 'include route reachable');
      const included = (await includeResponse.json()).included;
      const includedOwner = included?.find(r => r.type === 'owner');
      assert.ok(includedOwner, 'owner is included');

      const doc7 = await follow(assert, includedOwner.links.self, '(7) included resource links.self');
      assert.strictEqual(doc7?.data?.type, 'owner', '(7) followed URL returns the claimed type');
      assert.strictEqual(String(doc7?.data?.id), String(includedOwner.id), '(7) followed URL returns the claimed id');

      // (8) document links.self (related route) — orm-request.ts _generateRelationshipRoutes,
      //     related-resource route GET /:id/{relationship}
      const relatedResponse = await fetch(`${origin}${mount}/animals/1/owner`);
      assert.equal(relatedResponse.status, 200, 'related route reachable');
      const related = await relatedResponse.json();

      const doc8 = await follow(assert, related.links.self, '(8) document links.self (related route)');
      assert.strictEqual(doc8?.links?.self, related.links.self, '(8) fixed point');

      // (9)(10) linkage route — orm-request.ts _generateRelationshipRoutes,
      //         linkage route GET /:id/relationships/{relationship}
      const linkageResponse = await fetch(`${origin}${mount}/animals/1/relationships/owner`);
      assert.equal(linkageResponse.status, 200, 'linkage route reachable');
      const linkage = await linkageResponse.json();

      const doc9 = await follow(assert, linkage.links.self, '(9) document links.self (linkage route)');
      assert.strictEqual(doc9?.links?.self, linkage.links.self, '(9) fixed point');

      const doc10 = await follow(assert, linkage.links.related, '(10) document links.related (linkage route)');
      assert.strictEqual(doc10?.links?.self, linkage.links.related, '(10) related route republishes the URL as its self link');
    });
  });

  // ==========================================================================
  // AC2 — the link equals the URL that produced the response
  // ==========================================================================
  module('AC2 — link equals the producing URL', function() {
    const paths = [
      '/animals',
      '/animals/1',
      '/animals/1/owner',
      '/animals/1/relationships/owner',
    ];

    test('document links.self is exactly {origin}{mount}{path}', async function(assert) {
      for (const path of paths) {
        const url = `${origin}${mount}${path}`;
        const response = await fetch(url);
        assert.equal(response.status, 200, `GET ${url} -> 200`);

        const json = await response.json();
        assert.strictEqual(json.links.self, url, `${path}: links.self is exactly the requesting URL`);
      }
    });

    test('links.related on the linkage route is exactly the related-resource URL', async function(assert) {
      const url = `${origin}${mount}/animals/1/relationships/owner`;
      const response = await fetch(url);
      const json = await response.json();

      assert.strictEqual(json.links.related, `${origin}${mount}/animals/1/owner`, 'links.related is exact');
    });
  });

  // ==========================================================================
  // AC3 — the prefix tracks configuration, not a constant
  // ==========================================================================
  module('AC3 — prefix tracks configuration', function() {
    test(`harness mount for ORM_TEST_ROUTE="${ROUTE}" is real, and the published prefix equals it`, async function(assert) {
      assert.notStrictEqual(mount, undefined, `a mount was resolved for route "${ROUTE}"`);

      // Validation, not assumption: the 200 is what proves the harness mount is
      // the mount the server actually registered.
      const response = await fetch(`${origin}${mount}/animals`);
      assert.equal(response.status, 200, `mount "${mount}" is real — GET ${origin}${mount}/animals -> 200`);

      const json = await response.json();
      assert.strictEqual(json.links.self, `${origin}${mount}/animals`, 'published link carries exactly the mount');
      assert.strictEqual(new URL(json.links.self).pathname, `${mount}/animals`, 'published path is the mount plus the collection segment');
    });

    test('the origin root serves the collection only when the configured route is "/"', async function(assert) {
      const response = await fetch(`${origin}/animals`);

      if (mount === '') {
        assert.equal(response.status, 200, 'route "/" mounts at the origin root');
      } else {
        assert.equal(response.status, 404, `route "${ROUTE}" does not mount at the origin root`);
      }
    });
  });

  // ==========================================================================
  // AC4 — default-route output is byte-identical
  // ==========================================================================
  module('AC4 — default-route byte identity', function() {
    // AC4 is meaningful on exactly one row of the matrix. The other four rows
    // register it as a QUnit skip rather than short-circuiting into a padded
    // `assert.ok(true)`, so each row's `# pass` / `# skip` counts report what
    // actually ran instead of implying four extra byte-identity checks.
    const ac4Test = ROUTE === '/' ? test : test.skip;

    ac4Test('replaying the golden endpoint list at route "/" reproduces the fixture byte for byte', async function(assert) {
      assert.strictEqual(mount, '', 'the default route mounts at the origin root, so the golden replay is at the right prefix');

      const captured = {};

      for (const path of GOLDEN_ENDPOINTS) {
        const response = await fetch(`${origin}${path}`);
        const body = await response.text();

        // The port is environment-supplied (REST_PORT / MOUNTED_REST_PORT), so the
        // origin is the only substitution. Every path character is compared literally.
        captured[path] = { status: response.status, body: body.split(origin).join('{ORIGIN}') };
      }

      const actual = `${JSON.stringify(captured, null, 2)}\n`;

      // Regeneration hatch. This branch writes the artifact the assertions below
      // guard, so it must never be reachable in CI: nothing in package.json,
      // ci.yml or this harness sets GENERATE_LINKS_GOLDEN. Run it by hand only,
      // and review the fixture diff — an exported value would let the
      // byte-identity gate silently self-heal.
      if (process.env.GENERATE_LINKS_GOLDEN === '1') {
        await writeFile(GOLDEN_PATH, actual);
        assert.ok(true, `golden fixture regenerated: ${GOLDEN_PATH} (${Buffer.byteLength(actual)} bytes)`);
        return;
      }

      const expected = await readFile(GOLDEN_PATH, 'utf8');

      assert.strictEqual(
        Buffer.byteLength(actual),
        Buffer.byteLength(expected),
        `golden fixture byte length unchanged (${Buffer.byteLength(expected)} bytes)`
      );
      assert.strictEqual(actual, expected, 'default-route payloads are byte-identical to the golden fixture');
    });
  });

  // ==========================================================================
  // AC5 — link builder and mount registrar cannot drift
  // ==========================================================================
  module('AC5 — builder and registrar cannot drift', function() {
    // Same reasoning as AC4: registered for real only on the row it applies to,
    // skipped rather than padded on the other four.
    const ac5Test = ROUTE === '/api/' ? test : test.skip;

    ac5Test('route "/api/" — links match the probed mount, not a normalised guess', async function(assert) {
      assert.ok(PROBE_CANDIDATES.includes(mount), `mount was discovered by probing, not declared: "${mount}"`);

      const response = await fetch(`${origin}${mount}/animals`);
      assert.equal(response.status, 200, 'probed mount answers 200');

      const json = await response.json();
      assert.strictEqual(json.links.self, `${origin}${mount}/animals`, 'published link mirrors the registrar rather than normalising it');

      const followed = await fetch(json.links.self);
      assert.equal(followed.status, 200, 'published link at the trailing-slash route is followable');
    });
  });

  // AC6 is documentation (README.md, docs/project-structure.md). It is verified
  // by reviewer diff, not by a test, and is deliberately not dressed up as one.
});
