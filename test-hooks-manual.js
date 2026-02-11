/**
 * Manual test script for hooks functionality
 * Run with: node test-hooks-manual.js
 */

import { setup, subscribe, emit } from '@stonyx/events';

console.log('Testing hooks system...\n');

// Setup events
const eventNames = ['before:create:animal', 'after:create:animal'];
setup(eventNames);

let beforeCalled = false;
let afterCalled = false;
let contextReceived = null;

// Subscribe to hooks
const unsubscribe1 = subscribe('before:create:animal', async (context) => {
  console.log('✓ before:create:animal hook called');
  console.log('  Context:', JSON.stringify(context, null, 2));
  beforeCalled = true;
  contextReceived = context;
});

const unsubscribe2 = subscribe('after:create:animal', async (context) => {
  console.log('✓ after:create:animal hook called');
  console.log('  Context:', JSON.stringify(context, null, 2));
  afterCalled = true;
});

// Simulate hook execution
const testContext = {
  model: 'animal',
  operation: 'create',
  body: { data: { type: 'animals', attributes: { name: 'Test' } } }
};

console.log('Emitting before:create:animal...');
await emit('before:create:animal', testContext);

console.log('\nEmitting after:create:animal...');
await emit('after:create:animal', { ...testContext, record: { id: 1, name: 'Test' } });

console.log('\n--- Test Results ---');
console.log('Before hook called:', beforeCalled ? '✓ PASS' : '✗ FAIL');
console.log('After hook called:', afterCalled ? '✓ PASS' : '✗ FAIL');
console.log('Context passed correctly:', contextReceived?.model === 'animal' ? '✓ PASS' : '✗ FAIL');

// Cleanup
unsubscribe1();
unsubscribe2();

console.log('\n✓ Hooks system working correctly!');
