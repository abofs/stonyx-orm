// Type declarations for test dependencies without their own types
declare module 'qunit' {
  const QUnit: any;
  export default QUnit;
}

declare module 'sinon' {
  const sinon: any;
  export default sinon;
}

// Stonyx framework test helpers
declare module 'stonyx/test-helpers' {
  export function setupIntegrationTests(hooks: any): void;
}

declare module 'stonyx/config' {
  const config: any;
  export default config;
}
