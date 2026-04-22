const { withPlugins, withInfoPlist } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Expo config plugin for BloodPressureModule
 * Handles bundling and configuration of the native blood pressure prediction module
 */
const withBloodPressureModule = (config) => {
  return withPlugins(config, [
    // iOS configuration
    (iosConfig) => {
      return withInfoPlist(iosConfig, (modifiedConfig) => {
        // Add any iOS-specific Info.plist entries if needed
        modifiedConfig.modResults.BloodPressureModelVersion = '1.0.0';
        return modifiedConfig;
      });
    },
  ]);
};

module.exports = withBloodPressureModule;
