import QUnit from "qunit";
import Stonyx from "stonyx";
import ORM, { createRecord, store } from "@stonyx/orm";
import { setupIntegrationTests } from "stonyx/test-helpers";
import payload from "../sample/payload.js";

const { module, test } = QUnit;
//let endpoint;

// Driven by sample requests defined in test/sample-requests
module('[Integration] ORM', function(hooks) {
  setupIntegrationTests(hooks);

  module('store', function(hooks) {
    hooks.before(function() {
      // TODO: Test rest-server auto-configured ORM routes as well
      //endpoint = `http://localhost:${config.restServer.port}`;

      // Populate Sample Data Store
      for (const owner of payload.owners) createRecord('owner', owner);
      for (const animal of payload.animals) createRecord('animal', animal);
    });

    test('Data store is populated', async function(assert) {
      const bob = store.get('animal').get(14);
      console.log(bob);
      console.log(bob.id);
      assert.ok(true);
    });
  });
});
