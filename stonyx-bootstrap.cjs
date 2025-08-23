/**
 * commonJS Bootstrap loading - Stonyx must be loaded first, prior to the rest of the application
 */
const { default:Stonyx } = require('stonyx');
const { default:config } = require('./config/environment.js');

// Override paths for tests
Object.assign(config.paths, { 
  model: './test/sample/models',
  serializer: './test/sample/serializers',
  transform: './test/sample/transforms'
})

config.db.schema = './test/sample/db-schema.js';

new Stonyx(config, __dirname);

module.exports = Stonyx;
