Pod::Spec.new do |s|
  s.name = 'CDDMemoryProbe'
  s.version = '1.0.0'
  s.summary = 'CDD research process-memory sampling'
  s.description = 'Samples this application process during a user-started synthetic test.'
  s.license = { :type => 'MIT' }
  s.author = 'CDD project'
  s.homepage = 'https://github.com/ethankrol/cddapp'
  s.source = { :git => 'https://github.com/ethankrol/cddapp.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'CDDMemoryProbe_privacy' => ['PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
