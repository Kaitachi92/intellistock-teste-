require('ts-node/register/transpile-only');

const { createHubRouter } = require('../hub/routes/hub.routes');

module.exports = createHubRouter();