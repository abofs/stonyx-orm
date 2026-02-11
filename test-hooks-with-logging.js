/**
 * Test to verify hooks wrapper is being called
 */

import { emit } from '@stonyx/events';

// Simulate the _withHooks wrapper
function _withHooks(operation, handler, model) {
  console.log(`Creating wrapper for ${operation} on ${model}`);

  return async (request, state) => {
    console.log(`Wrapper called for ${operation} on ${model}`);

    const context = {
      model,
      operation,
      request,
    };

    console.log(`About to emit before:${operation}:${model}`);
    await emit(`before:${operation}:${model}`, context);
    console.log(`Emitted before hook`);

    const response = await handler(request, state);
    console.log(`Handler completed`);

    context.response = response;
    await emit(`after:${operation}:${model}`, context);
    console.log(`Emitted after hook`);

    return response;
  };
}

// Simulate a handler
const createHandler = ({ body }) => {
  console.log('Original handler called');
  return { data: { id: 1, ...body } };
};

// Create wrapped handler
const wrappedHandler = _withHooks('create', createHandler, 'animal');

// Simulate a request
const mockRequest = {
  body: { name: 'Test' }
};

console.log('\n=== Testing wrapper ===');
const result = await wrappedHandler(mockRequest, {});
console.log('Result:', result);
console.log('\n✓ Wrapper test completed');
