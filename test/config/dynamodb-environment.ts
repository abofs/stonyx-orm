export default {
  orm: {
    dynamodb: {
      region: 'us-east-1',
      endpoint: 'http://localhost:8000',
      tablePrefix: 'test_',
    },
    paths: {
      model: './test/integration/dynamodb/models',
    },
  },
};
