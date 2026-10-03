'use strict';
/* Detectors under evaluation. Each is (text) => boolean, true meaning "flag as a scam".
   router_v0 is the shipped keyword router used as a scam/not-scam classifier. It was built to route
   chat questions, not to classify messages, so a poor score is expected; it is the baseline to beat. */
const core = require('../lib/core.js');

module.exports = {
  always_scam: () => true,
  never_scam: () => false,
  router_v0: text => core.detectIntent(text) !== null
};
