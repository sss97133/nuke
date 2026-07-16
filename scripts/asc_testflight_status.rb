#!/usr/bin/env ruby
# asc_testflight_status.rb — "why isn't the build on my phone?"
# Reads the real TestFlight state of the latest builds for ag.nuke.capture from
# the App Store Connect API: processing state, export compliance, expiry, and
# which tester groups each build is assigned to. A build only reaches a phone
# when processingState=VALID, compliance is answered, and it's in a group your
# Apple ID belongs to.
#
#   ASC_ISSUER_ID=<uuid> ruby asc_testflight_status.rb
#
# Env overrides: ASC_KEY_ID (default 77637BYL66), ASC_KEY_PATH, ASC_BUNDLE_ID.

require 'openssl'; require 'json'; require 'base64'; require 'net/http'; require 'uri'; require 'time'

KEY_ID = ENV['ASC_KEY_ID']    || '77637BYL66'
ISSUER = ENV['ASC_ISSUER_ID'] || ARGV[0] or abort "Set ASC_ISSUER_ID (ASC → Users and Access → Integrations → Issuer ID) or pass as arg 1."
BUNDLE = ENV['ASC_BUNDLE_ID'] || 'ag.nuke.capture'
P8 = [ ENV['ASC_KEY_PATH'],
       File.expand_path("~/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/.appstoreconnect/private_keys/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/private_keys/AuthKey_#{KEY_ID}.p8")
     ].compact.find { |p| File.exist?(p) } or abort "Could not find AuthKey_#{KEY_ID}.p8 — set ASC_KEY_PATH=/path/to/key.p8"

def b64(s) = Base64.urlsafe_encode64(s).delete('=')

key  = OpenSSL::PKey.read(File.read(P8))
now  = Time.now.to_i
head = b64({alg:'ES256', kid:KEY_ID, typ:'JWT'}.to_json)
body = b64({iss:ISSUER, iat:now, exp:now + 15*60, aud:'appstoreconnect-v1'}.to_json)
der  = key.dsa_sign_asn1(OpenSSL::Digest::SHA256.digest("#{head}.#{body}"))
a    = OpenSSL::ASN1.decode(der).value
JWT  = "#{head}.#{body}.#{b64(a[0].value.to_s(2).rjust(32,"\x00") + a[1].value.to_s(2).rjust(32,"\x00"))}"

def api(path)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  req = Net::HTTP::Get.new(uri); req['Authorization'] = "Bearer #{JWT}"
  res = Net::HTTP.start(uri.host, 443, use_ssl: true) { |h| h.request(req) }
  abort "HTTP #{res.code} on #{path}\n#{res.body}" unless res.code.to_i.between?(200, 299)
  JSON.parse(res.body)
end

app = api("/v1/apps?filter[bundleId]=#{BUNDLE}&limit=1")['data'].first or abort "No app for bundle #{BUNDLE} on this key's team."
puts "App: #{app.dig('attributes','name')} (#{BUNDLE})\n\n"

resp = api("/v1/builds?filter[app]=#{app['id']}&limit=5&sort=-uploadedDate" \
           "&include=preReleaseVersion,betaGroups" \
           "&fields[builds]=version,processingState,expired,usesNonExemptEncryption,uploadedDate,preReleaseVersion,betaGroups" \
           "&fields[betaGroups]=name,isInternalGroup&fields[preReleaseVersions]=version")
inc = {}
(resp['included'] || []).each { |o| inc[[o['type'], o['id']]] = o }

resp['data'].each do |b|
  at = b['attributes']
  pre = b.dig('relationships','preReleaseVersion','data')
  mver = pre ? inc.dig([pre['type'], pre['id']], 'attributes', 'version') : '?'
  groups = (b.dig('relationships','betaGroups','data') || []).map do |g|
    o = inc[[g['type'], g['id']]]; next g['id'] unless o
    "#{o.dig('attributes','name')}#{o.dig('attributes','isInternalGroup') ? ' [internal]' : ' [external]'}"
  end
  comp = case at['usesNonExemptEncryption']
         when nil   then 'MISSING — answer export compliance (this blocks TestFlight)'
         when true  then 'declared: uses non-exempt encryption (needs docs)'
         when false then 'OK (exempt)'
         end
  reachable = at['processingState'] == 'VALID' && !at['usesNonExemptEncryption'].nil? && !groups.empty? && !at['expired']
  puts "Build #{mver} (#{at['version']})  uploaded #{at['uploadedDate']}"
  puts "  processing : #{at['processingState']}#{at['expired'] ? '  EXPIRED' : ''}"
  puts "  compliance : #{comp}"
  puts "  groups     : #{groups.empty? ? '(NONE — not assigned to any tester group → will not appear on any phone)' : groups.join(', ')}"
  puts "  → on a phone? #{reachable ? 'YES (in a group, valid, compliant)' : 'NO — fix the field(s) above'}"
  puts
end
