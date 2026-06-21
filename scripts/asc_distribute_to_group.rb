#!/usr/bin/env ruby
# asc_distribute_to_group.rb — push a build to a TestFlight group so it reaches
# phones. Default group "Nuke Internal". Waits for processing to finish, then
# assigns the build to the group. Internal groups distribute immediately (no
# Beta App Review).
#
#   ASC_ISSUER_ID=<uuid> ruby asc_distribute_to_group.rb                 # latest uploaded build
#   ASC_ISSUER_ID=<uuid> ASC_BUILD_VERSION=78901234 ruby asc_distribute_to_group.rb
#
# Env: ASC_KEY_ID (77637BYL66), ASC_KEY_PATH, ASC_BUNDLE_ID (ag.nuke.capture),
#      ASC_GROUP_NAME ("Nuke Internal"), ASC_BUILD_VERSION (optional, else latest),
#      ASC_WAIT_SECONDS (default 1800). Key needs App Manager role.

require 'openssl'; require 'json'; require 'base64'; require 'net/http'; require 'uri'; require 'time'

KEY_ID   = ENV['ASC_KEY_ID']      || '77637BYL66'
ISSUER   = ENV['ASC_ISSUER_ID']   || ARGV[0] or abort "Set ASC_ISSUER_ID (ASC → Users and Access → Integrations) or pass as arg 1."
BUNDLE   = ENV['ASC_BUNDLE_ID']   || 'ag.nuke.capture'
GROUP    = ENV['ASC_GROUP_NAME']  || 'Nuke Internal'
WANT_VER = ENV['ASC_BUILD_VERSION']
WAIT     = (ENV['ASC_WAIT_SECONDS'] || '1800').to_i
P8 = [ ENV['ASC_KEY_PATH'],
       File.expand_path("~/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/.appstoreconnect/private_keys/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/private_keys/AuthKey_#{KEY_ID}.p8")
     ].compact.find { |p| File.exist?(p) } or abort "Could not find AuthKey_#{KEY_ID}.p8 — set ASC_KEY_PATH."

def b64(s) = Base64.urlsafe_encode64(s).delete('=')
def jwt
  key = OpenSSL::PKey.read(File.read(P8)); now = Time.now.to_i
  h = b64({alg:'ES256', kid:KEY_ID, typ:'JWT'}.to_json)
  p = b64({iss:ISSUER, iat:now, exp:now + 15*60, aud:'appstoreconnect-v1'}.to_json)
  der = key.dsa_sign_asn1(OpenSSL::Digest::SHA256.digest("#{h}.#{p}"))
  a = OpenSSL::ASN1.decode(der).value
  "#{h}.#{p}.#{b64(a[0].value.to_s(2).rjust(32,"\x00") + a[1].value.to_s(2).rjust(32,"\x00"))}"
end

def call(method, path, body = nil)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  req = (method == :post ? Net::HTTP::Post : Net::HTTP::Get).new(uri)
  req['Authorization'] = "Bearer #{jwt}"; req['Content-Type'] = 'application/json'
  req.body = body.to_json if body
  res = Net::HTTP.start(uri.host, 443, use_ssl: true) { |x| x.request(req) }
  abort "HTTP #{res.code} #{method.to_s.upcase} #{path}\n#{res.body}" unless res.code.to_i.between?(200, 299)
  res.body.to_s.empty? ? {} : JSON.parse(res.body)
end

app   = call(:get, "/v1/apps?filter[bundleId]=#{BUNDLE}&limit=1")['data'].first or abort "No app for #{BUNDLE} on this key's team."
appid = app['id']

groups = call(:get, "/v1/betaGroups?filter[app]=#{appid}&limit=200&fields[betaGroups]=name,isInternalGroup")['data']
g = groups.find { |x| x.dig('attributes', 'name').to_s.strip.casecmp?(GROUP) } \
  or abort "No TestFlight group named #{GROUP.inspect}. Found: #{groups.map { |x| x.dig('attributes','name') }.join(', ')}"
puts "Group: #{g.dig('attributes','name')} #{g.dig('attributes','isInternalGroup') ? '[internal]' : '[external — needs Beta App Review]'}"

q = WANT_VER ? "&filter[version]=#{WANT_VER}" : ""
build = call(:get, "/v1/builds?filter[app]=#{appid}#{q}&sort=-uploadedDate&limit=1&fields[builds]=version,processingState")['data'].first \
  or abort "No build found#{WANT_VER ? " for build #{WANT_VER}" : ''}."
bid = build['id']
puts "Build: #{build.dig('attributes','version')} (#{bid})"

deadline = Time.now + WAIT
loop do
  st = call(:get, "/v1/builds/#{bid}?fields[builds]=processingState").dig('data', 'attributes', 'processingState')
  puts "  processingState=#{st}"
  break if st == 'VALID'
  abort "Build is #{st} — cannot distribute." if %w[INVALID FAILED].include?(st)
  abort "Timed out after #{WAIT}s waiting for processing." if Time.now > deadline
  sleep 30
end

call(:post, "/v1/betaGroups/#{g['id']}/relationships/builds", { data: [{ type: 'builds', id: bid }] })
puts "✅ Build #{build.dig('attributes','version')} pushed to #{GROUP}. Internal testers get it now."
