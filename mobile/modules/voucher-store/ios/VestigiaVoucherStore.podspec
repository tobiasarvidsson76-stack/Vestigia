Pod::Spec.new do |s|
  s.name = 'VestigiaVoucherStore'
  s.version = '1.0.0'
  s.summary = 'Vestigia platform voucher purchases'
  s.description = 'StoreKit 2 interface for the Vestigia five-voucher consumable.'
  s.license = 'UNLICENSED'
  s.author = 'Vestigia'
  s.homepage = 'https://github.com/tobiasarvidsson76-stack/Vestigia'
  s.source = { :git => s.homepage + '.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
