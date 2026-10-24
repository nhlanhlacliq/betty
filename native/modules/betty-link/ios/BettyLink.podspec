Pod::Spec.new do |s|
  s.name           = 'BettyLink'
  s.version        = '1.0.0'
  s.summary        = 'Betty Link: her voice conversation over one WebSocket, all phone audio in one place'
  s.author         = 'Betty'
  s.homepage       = 'https://betty-zeta.vercel.app'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
end
