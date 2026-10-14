// Callback UI tests do not render canvas. Treat this optional native dependency
// as absent while loading Jest's jsdom, including on CI without canvas binaries.
const Module = require('node:module');
const originalResolve = Module._resolveFilename;
let environment;
try {
  Module._resolveFilename = function (request, ...args) {
    if (request === 'canvas') {
      const error = new Error('Canvas is not used by connection UI tests');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalResolve.call(this, request, ...args);
  };
  // Jest loads jsdom lazily from the environment constructor. Preload the
  // same copy while optional-canvas resolution is disabled.
  Module.createRequire(require.resolve('jest-environment-jsdom'))('jsdom');
  environment = require('jest-environment-jsdom').TestEnvironment;
} finally {
  Module._resolveFilename = originalResolve;
}
module.exports = environment;
