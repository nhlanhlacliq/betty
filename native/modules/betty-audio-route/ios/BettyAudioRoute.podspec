Pod::Spec.new do |s|
  s.name           = 'BettyAudioRoute'
  s.version        = '1.0.0'
  s.summary        = 'Betty: the helmet in call mode only while the rider talks'
  s.author         = 'Betty'
  s.homepage       = 'https://betty-zeta.vercel.app'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
end
