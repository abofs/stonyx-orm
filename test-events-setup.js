/**
 * Debug script to verify event setup
 */

import Stonyx from 'stonyx';
import config from './config/environment.js';
import Orm from './src/main.js';
import { subscribe } from '@stonyx/events';

// Override paths for tests
Object.assign(config.paths, {
  access: './test/sample/access',
  model: './test/sample/models',
  serializer: './test/sample/serializers',
  transform: './test/sample/transforms'
});

// Override db settings for tests
Object.assign(config.db, {
  file: './test/sample/db.json',
  schema: './test/sample/db-schema.js'
});

new Stonyx(config, import.meta.dirname);

const orm = new Orm();
await orm.init();

console.log('ORM initialized');
console.log('Store keys:', Array.from(Orm.store.data.keys()));

// Try subscribing to an event
try {
  const unsubscribe = subscribe('before:create:animal', (context) => {
    console.log('Hook called!', context);
  });
  console.log('✓ Successfully subscribed to before:create:animal');
  unsubscribe();
} catch (error) {
  console.error('✗ Failed to subscribe:', error.message);
}
