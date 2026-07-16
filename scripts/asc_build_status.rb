#!/usr/bin/env ruby
# asc_build_status.rb — query the REAL Xcode Cloud build status from the
# App Store Connect API. Zero gems; uses only Ruby stdlib (preinstalled on macOS).
#
#   ASC_ISSUER_ID=<uuid> ruby asc_build_status.rb
#   # or pass issuer id as the first argument:
#   ruby asc_build_status.rb 69a6de7e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# Env overrides (all optional except the issuer id):
#   ASC_KEY_ID    default 77637BYL66
#   ASC_KEY_PATH  default ~/AuthKey_<KEY_ID>.p8   (also tries ~/.appstoreconnect/private_keys/)
#   ASC_BUNDLE_ID default ag.nuke.capture

require 'openssl'; require 'json'; require 'base64'; require 'net/http'; require 'uri'; require 'time'

KEY_ID  = ENV['ASC_KEY_ID']    || '77637BYL66'
ISSUER  = ENV['ASC_ISSUER_ID'] || ARGV[0] or abort "Set ASC_ISSUER_ID (App Store Connect > Users and Access > Integrations > App Store Connect API > Issuer ID), or pass it as arg 1."
BUNDLE  = ENV['ASC_BUNDLE_ID']  || 'ag.nuke.capture'
P8 = [ ENV['ASC_KEY_PATH'],
       File.expand_path("~/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/.appstoreconnect/private_keys/AuthKey_#{KEY_ID}.p8"),
       File.expand_path("~/private_keys/AuthKey_#{KEY_ID}.p8")
     ].compact.find { |p| File.exist?(p) } or abort "Could not find AuthKey_#{KEY_ID}.p8. Set ASC_KEY_PATH=/path/to/key.p8"

def b64(s) = Base64.urlsafe_encode64(s).delete('=')

key = OpenSSL::PKey.read(File.read(P8))
now = Time.now.to_i
head = b64({alg:'ES256', kid:KEY_ID, typ:'JWT'}.to_json)
body = b64({iss:ISSUER, iat:now, exp:now + 15*60, aud:'appstoreconnect-v1'}.to_json)
der  = key.dsa_sign_asn1(OpenSSL::Digest::SHA256.digest("#{head}.#{body}"))
a    = OpenSSL::ASN1.decode(der).value
sig  = b64(a[0].value.to_s(2).rjust(32, "\x00") + a[1].value.to_s(2).rjust(32, "\x00"))
JWT  = "#{head}.#{body}.#{sig}"

def api(path)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  req = Net::HTTP::Get.new(uri); req['Authorization'] = "Bearer #{JWT}"
  res = Net::HTTP.start(uri.host, 443, use_ssl: true) { |h| h.request(req) }
  abort "HTTP #{res.code} on #{path}\n#{res.body}" unless res.code.to_i.between?(200, 299)
  JSON.parse(res.body)
end

app = api("/v1/apps?filter[bundleId]=#{BUNDLE}&limit=1")['data'].first or abort "No app found for bundle #{BUNDLE} on this key's team."
puts "App: #{app.dig('attributes','name')}  (#{BUNDLE}, id #{app['id']})"

prods = api("/v1/ciProducts?filter[app]=#{app['id']}&limit=1")['data']
if prods.empty?
  abort "No Xcode Cloud product is attached to this app. The build failure may be that Xcode Cloud is not (or no longer) wired to #{BUNDLE}."
end
pid = prods.first['id']

runs = api("/v1/ciProducts/#{pid}/buildRuns?limit=3&sort=-number" \
           "&fields[ciBuildRuns]=number,createdDate,startedDate,finishedDate,executionProgress,completionStatus,isPullRequestBuild,issueCounts")['data']
abort "Xcode Cloud product exists but has no build runs yet." if runs.empty?

runs.each_with_index do |run, i|
  at = run['attributes']
  puts "\n=== Build ##{at['number']}  progress=#{at['executionProgress']}  status=#{at['completionStatus'] || '(in progress)'}  started=#{at['startedDate']}"
  next unless i.zero?  # drill into the most recent run only
  actions = api("/v1/ciBuildRuns/#{run['id']}/actions" \
                "&fields[ciBuildActions]=name,actionType,executionProgress,completionStatus,issueCounts")['data'] rescue
            api("/v1/ciBuildRuns/#{run['id']}/actions?fields[ciBuildActions]=name,actionType,executionProgress,completionStatus,issueCounts")['data']
  actions.each do |act|
    aa = act['attributes']
    puts "  - #{aa['name']} [#{aa['actionType']}]: #{aa['completionStatus'] || aa['executionProgress']}"
    next unless %w[FAILED ERRORED].include?(aa['completionStatus'])
    issues = api("/v1/ciBuildActions/#{act['id']}/issues")['data'] rescue []
    issues.each { |is| puts "      ! #{is.dig('attributes','issueType')}: #{is.dig('attributes','message')}" }
    arts = api("/v1/ciBuildActions/#{act['id']}/artifacts?filter[type]=LOGS_FILE_ZIP")['data'] rescue []
    arts.each do |art|
      dl = api("/v1/ciArtifacts/#{art['id']}")['data'].dig('attributes','downloadUrl') rescue nil
      puts "      logs: #{dl}" if dl
    end
  end
end
