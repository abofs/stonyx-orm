/**
 * commonJS Bootstrap loading - Stonyx must be loaded first, prior to the rest of the application
 */
const { default:Stonyx } = require('stonyx');
const { default:config } = require('./config/environment.js');

// Override paths for tests
Object.assign(config.paths, { 
  access: './test/sample/access',
  model: './test/sample/models',
  serializer: './test/sample/serializers',
  transform: './test/sample/transforms'
})

// Override db settings for tests
Object.assign(config.db, {
  file: './test/sample/db.json',
  schema: './test/sample/db-schema.js'
});

// Create restServer module path for tests
config.modules = {
  restServer: {
    dir: './test/sample/requests'
  }
}

new Stonyx(config, __dirname);

module.exports = Stonyx;
