const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add SVG support
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts.push('svg');

module.exports = config;
// SQLITE_WEB_SETUP
;(() => {
  const config = module.exports;

  if (!config.resolver.assetExts.includes('wasm')) {
    config.resolver.assetExts.push('wasm');
  }

  const previous = config.server.enhanceMiddleware;

  config.server.enhanceMiddleware = (middleware, server) => {
    const handler = previous ? previous(middleware, server) : middleware;

    return (req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      return handler(req, res, next);
    };
  };
})();

// CBP_ONNX_ASSET_SUPPORT
;(() => {
  const config = module.exports;
  if (!config.resolver || !Array.isArray(config.resolver.assetExts)) {
    throw new Error('Expected an object Metro config with resolver.assetExts.');
  }
  if (!config.resolver.assetExts.includes('onnx')) config.resolver.assetExts.push('onnx');
})();
