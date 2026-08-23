# =================================================================
# NetPulse ISP Manager — RouterOS Full Setup (Stage 2)
# Router:    MAJE_TEMP
# Generated: 2026-08-23T07:26:38.894Z
# Server:    netpulse.co.ke:1194/TCP

# =================================================================

:log info message="NetPulse: configuring MAJE_TEMP"
:put ""
:put "======================================"
:put "  NetPulse Full Configuration"
:put "  Router: MAJE_TEMP"
:put "======================================"

# ── 1/8  Remove previous NetPulse config ─────────────────────────────────────
:put "[1/8] Cleaning old config..."
:do { /interface ovpn-client remove [find name="netpulse-vpn"] } on-error={}
:delay 1s
:do { /certificate remove [find name~"netpulse"] } on-error={}
:delay 1s
:do { /file remove [find name~"netpulse-"] } on-error={}
:delay 1s

# ── 2/8  Write certificate + key files ───────────────────────────────────────
:put "[2/8] Writing certificates..."

/file add name="netpulse-ca.pem"     contents="-----BEGIN CERTIFICATE-----\nMIIDNzCCAh+gAwIBAgIHAAGf519TuzANBgkqhkiG9w0BAQsFADA6MRQwEgYDVQQD\nEwtOZXRQdWxzZSBDQTEVMBMGA1UEChMMTmV0UHVsc2UgSVNQMQswCQYDVQQGEwJL\nRTAeFw0yNjA4MDkxNjMzMzJaFw0zNjA4MDkxNjMzMzJaMDoxFDASBgNVBAMTC05l\ndFB1bHNlIENBMRUwEwYDVQQKEwxOZXRQdWxzZSBJU1AxCzAJBgNVBAYTAktFMIIB\nIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAopEAlld1Iba0JzoqjHBnyYNF\nKDB7e9jMe4Cx0ipqFZgYg36NyYAymbNjraV3RAE9qDzcXa9t+GauHB7Kb8mSMhfZ\ngvm5srIdP0s26tIVxWH9jrHaLwIrhwgpWhwa7ntBJlww/lGoPAkzQJ3gJFx6WWxh\nK9UuPIUT3fGbJFY9TplvSTwGCaSsXXvppKgozEYzSHFrRc0axLaF386gglCxYcXK\n0z2SOG/8po8+aU12VT4HAzPBtTHShR5JWmNS/wrSHjiFMb4MWnl2U/cZeECoz4cx\nBw8KQW98t62+MhlrVQX7LFWzXdmFe1gnfOASU9o91nLcQzxuZYgI27QrCCtUkQID\nAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4E\nFgQUEylX+D/sVc6/ljRgkacRep7OPOQwDQYJKoZIhvcNAQELBQADggEBAByFFe0V\nI7FI9lSxxbKXWIU8gUReRU4OcIbBhoD0Up2ohDi3BgMKJwddE74fk1tbj3MbNC4O\nGnbOvtG01H7/PQRblh+lcsu0l3KCv0RbTZXg9TT0zRAm/9qPjVAy4M/Ihx+zumoH\nPqsv9evyr5hMW0aI2bEoqmhhF5tvD+z7a2Nv6woTdGOEFL8PnvcGCAvCLHEoLF10\nxMXxPjTmv1uKjtzOPl2THxbZW+qK99lotu1f47IHkQyYWXFZRWoGInzonVe+xyr4\nUbykc4yy/FvrgbsYGPnWjdFinBJ3TAq70PZ2o7Jl+5u9KrHMIwzGnk/mA3JZCDeJ\nSI2f0dit9HGKzr0=\n-----END CERTIFICATE-----"
/file add name="netpulse-client.pem" contents="-----BEGIN CERTIFICATE-----\nMIIDQDCCAiigAwIBAgIHAAGgLYGOmDANBgkqhkiG9w0BAQsFADA6MRQwEgYDVQQD\nEwtOZXRQdWxzZSBDQTEVMBMGA1UEChMMTmV0UHVsc2UgSVNQMQswCQYDVQQGEwJL\nRTAeFw0yNjA4MjMwNzI0MjBaFw0zNjA4MjMwNzI0MjBaMDQxGzAZBgNVBAMTEm5l\ndHB1bHNlLW1hamUtdGVtcDEVMBMGA1UEChMMTmV0UHVsc2UgSVNQMIIBIjANBgkq\nhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAutxVwmhcZs4weu26Rq7OJ7v/E9jnCHBD\n49YE+U9Ry/JkTcAauzChChMoqd/1Mpo1gKvs9Aidc5T6Q3/hMYYC4nLlH/0F2qVE\nOI6BihZy42xbAL9ygoqhKPqGwU0Vqt1qVwyBT28cFPmfGEWFGFxzJgv5djy53ri0\nYAOkGAKFh4MGZ4Q0pk6f1isL/AjC1+ffWw1bErUUqRpuJG2IYU4g9UYqpJ6lHs+t\n3tDvNhglbbOmKo1z5ZtcSKhuhxRvL1HNqTGcHTJA/Vg6AH2uv5eJBUPmEF9KWZTu\np+NJ8iWz0k9i+X7kGPn5DM5h5ocGQtruiI9Zd1j9opEyVrJgwa9hrwIDAQABo1Ew\nTzAJBgNVHRMEAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcD\nAjAdBgNVHQ4EFgQU/4vTan5pygiBHZhTiVK9/DvpiNkwDQYJKoZIhvcNAQELBQAD\nggEBAGci9o0FuKiykgjuRW5NEO7UH/1Q4p/uBlv63+Aj8h7kFxFbQrHTYBFph0en\n9SXDobJBqf0kBd6wbVKsTvtnuIL95Uro5hw182AQ9ttAVEsGpHwfPXYhcevhUvOs\n8CP+HwTa88B0kfEiZnts19AcnJndAuD3lhyS0p9RRkQstGt9sowI8vXnbGnr/UeU\nc1JkRFHyhscKBemzgGRbrjX6eeDfjOYZ1CBAO5eEZcxIUvtLBV4qmH717C72mtGm\n3/4x7jeAc/E/ZLNLmcuc2lJm6ZUGsMmWadCN+63mPm1ofWYmtCxlMfalkJUU5lzN\nH22hq+uCtSQZKjYv1fZnkwFlZoE=\n-----END CERTIFICATE-----"
/file add name="netpulse-client.key" contents="-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEAutxVwmhcZs4weu26Rq7OJ7v/E9jnCHBD49YE+U9Ry/JkTcAa\nuzChChMoqd/1Mpo1gKvs9Aidc5T6Q3/hMYYC4nLlH/0F2qVEOI6BihZy42xbAL9y\ngoqhKPqGwU0Vqt1qVwyBT28cFPmfGEWFGFxzJgv5djy53ri0YAOkGAKFh4MGZ4Q0\npk6f1isL/AjC1+ffWw1bErUUqRpuJG2IYU4g9UYqpJ6lHs+t3tDvNhglbbOmKo1z\n5ZtcSKhuhxRvL1HNqTGcHTJA/Vg6AH2uv5eJBUPmEF9KWZTup+NJ8iWz0k9i+X7k\nGPn5DM5h5ocGQtruiI9Zd1j9opEyVrJgwa9hrwIDAQABAoIBAFzUJ+CH8tt5tDjl\nj8QchDrWGJ6WAxQ8nWV6xYbLImIUnULI3B7BRkdYhDt8EHYeiNTO1EzZWMr6KCfP\nSCLPpfA0TuJI0xcvQghstyrQAyw7AKyK70qtrulKKBawgkKbc4AiLL02//blmWU3\n6CpVhzjP+xKDkXz1Olp2hJcO7aIHGhF4nYLAsLk6ClWSkx3dC/Fm6cQL97ZPoKjQ\nqullOn/Un+tF4ScOcpUcZO99mGb9QY6hsl5CMtoPCUF1OfEKgyPnFMWd742eJLSe\nzWad89dB/kMkAwwVlh2eD8k3QgQgUT0J8E9JVrHgtQ9Rvjii3fU41fDxW6jPGFOH\niGjEbVUCgYEA6vhmzFJBMOVuHJI91z8hxCjO+JemhSig5+kgf8+xnUikaVridptN\n8JoYLomtkMSlvDOp1BCJQPThfCsgnBicGku+VjjY4/+zM2HK1AnBfNIg5MGP0oYr\niVhrd1vrxx21DhCdj2fxsg9FvGdTLQBmncI/+ZcWeGcjthTsXtxIpmsCgYEAy5Wn\na1RAW7xSNMWhIX6IoHqIjh7ni9LeWBeJkKlLLiDUmWdZSQY7hYPqucNIHzS6S1tH\nNZp2l1s7bkrGnPAfVbieww/MZtW5/HFvZr1HlP6uEfbvZ/kmMGMGoaIqeNRFvxPD\nf++zCdmNq+Kny9uoFbkE7h+iJEenFLQ6g54h2s0CgYBlOGzQR/7dWXh9xmHtf7zE\nC/BdFrcdVcs7HCpr5MTWxJxO5l/4SB7jLv6LzbN/Ubczw+289QKrgNJB8zIxDEjy\n6v4rloGYdmZ0FASUIz++zaZt5RRX1IScvgJNgMOpGxsL3AyD4ns0AXBBISGrmSib\nfTqiAnwjkgrIPWs10h9Z0QKBgCqcTydawgGxX+9lsf0Fs+kK3IwKkeIlJ55+hq99\nj5u/CWB2TizHniuq2bU5112YtqlRGI1yoAG7+atzATEV3Ske9DPVma2obD4XK/7v\n/QyFZb+i1KcJceHMyDWKcKNLorGEnHWpoOqd21YvoXk8p2isigihHFnFmYXu1xR3\nQ5S9AoGATnUCPckQFsshncIE4jRiM/LvWKTyQPTNyy0QMJY2iGk7mmWemvHWku/I\nm5TnzxEQTNqoZVlba9IHp0XA63vVETzFwXI5q88My3yyijVSZuCQa5Q+eIEHNCCh\nZ/Q8Uuev3b2EqV1SF6NNMl+E85S5GAPXVIsy0SnlRxI5R3BGbAk=\n-----END RSA PRIVATE KEY-----"
:delay 2s

# ── 3/8  Import certificates ──────────────────────────────────────────────────
:put "[3/8] Importing certificates (~15 seconds)..."

/certificate import file-name="netpulse-ca.pem"     passphrase="" name="netpulse-ca"
:delay 4s
/certificate import file-name="netpulse-client.pem" passphrase="" name="netpulse-client"
:delay 4s
/certificate import file-name="netpulse-client.key" passphrase="" name="netpulse-client"
:delay 4s

:local caCert [/certificate find where name="netpulse-ca" and !private-key]
:if ([:len $caCert] = 0) do={
  :log error "NetPulse: CA cert import failed"
  :error "CA certificate import failed"
}

# ── 4/8  Create OpenVPN tunnel interface ──────────────────────────────────────
:put "[4/8] Creating OpenVPN tunnel..."

:do {
  /interface ovpn-client add \
    name="netpulse-vpn" \
    connect-to="netpulse.co.ke" \
    port=1194 \
    mode=ip \
    protocol=tcp \
    certificate="netpulse-client" \
    add-default-route=no \
    disabled=no
} on-error={ :log warning "NetPulse: ovpn-client already exists" }

:put "Waiting 20 seconds for tunnel..."
:delay 20s

# ── 5/8  Configure RADIUS over VPN ───────────────────────────────────────────
:put "[5/8] Configuring RADIUS..."

:do { /radius remove [find address="10.8.0.1" and service~"ppp"] } on-error={}

/radius add \
  address="10.8.0.1" \
  secret="TETHER" \
  service=ppp,hotspot \
  authentication-port=1812 \
  accounting-port=1813 \
  timeout=3000 \
  realm=""

/ppp aaa set use-radius=yes accounting=yes

# ── 6/8  Create NETPULSE bridge + PPPoE server + Hotspot server ───────────────
:put "[6/8] Creating NETPULSE bridge + PPPoE + Hotspot..."

# -- Bridge --
:do { /interface bridge remove [find name="NETPULSE"] } on-error={}
:delay 1s
/interface bridge add name="NETPULSE" protocol-mode=rstp comment="netpulse-managed"

# -- Add ether2 as LAN port (default) --
:do { /interface bridge port remove [find interface="ether2"] } on-error={}
/interface bridge port add interface=ether2 bridge=NETPULSE comment="netpulse-lan"

# -- PPPoE server --
:do { /ip pool remove [find name="netpulse-pppoe-pool"] } on-error={}
/ip pool add name="netpulse-pppoe-pool" ranges=10.0.10.1-10.0.10.254

:do { /ppp profile remove [find name="netpulse-profile"] } on-error={}
/ppp profile add \
  name="netpulse-profile" \
  local-address=10.0.10.254 \
  remote-address=netpulse-pppoe-pool \
  use-encryption=yes \
  dns-server=8.8.8.8,8.8.4.4

:do { /interface pppoe-server server remove [find comment="netpulse-pppoe"] } on-error={}
/interface pppoe-server server add \
  service-name="netpulse-pppoe" \
  interface=NETPULSE \
  default-profile=netpulse-profile \
  one-session-per-host=yes \
  enabled=yes \
  authentication=mschap2,mschap1,chap,pap \
  comment="netpulse-pppoe"

# -- Hotspot --
:do { /ip hotspot remove [find comment="netpulse-hotspot"] } on-error={}
:do { /ip hotspot profile remove [find name="netpulse-hs"] } on-error={}
:do { /ip pool remove [find name="netpulse-hs-pool"] } on-error={}
:do { /ip address remove [find comment="netpulse-hs-addr"] } on-error={}
:delay 1s

/ip pool add name="netpulse-hs-pool" ranges=192.168.10.2-192.168.10.254
/ip address add address=192.168.10.1/24 interface=NETPULSE comment="netpulse-hs-addr"
:delay 2s

/ip hotspot profile add \
  name="netpulse-hs" \
  hotspot-address=192.168.10.1 \
  use-radius=yes \
  radius-address="10.8.0.1" \
  radius-secret="TETHER" \
  login-by=http-chap,mac \
  mac-auth-mode=mac-as-username+password

/ip hotspot add \
  name="netpulse-hotspot" \
  interface=NETPULSE \
  address-pool=netpulse-hs-pool \
  profile=netpulse-hs \
  idle-timeout=none \
  keepalive-timeout=none \
  comment="netpulse-hotspot"

# ── 7/8  Routing + firewall ───────────────────────────────────────────────────
:put "[7/8] Configuring routing..."

:do { /ip route remove [find comment="netpulse-radius-route"] } on-error={}
/ip route add \
  dst-address="10.8.0.1/32" \
  gateway="netpulse-vpn" \
  comment="netpulse-radius-route"

:do {
  /ip firewall filter add \
    chain=input \
    in-interface="netpulse-vpn" \
    protocol=udp \
    dst-port=1812-1813 \
    action=accept \
    comment="netpulse-radius-in" \
    place-before=0
} on-error={}

# ── Verify ────────────────────────────────────────────────────────────────────
:delay 3s
:local running false
:do { :set running [/interface ovpn-client get [find name="netpulse-vpn"] running] } on-error={}

:put ""
:put "======================================"
:if ($running = true) do={
  :put "  STATUS: CONNECTED"
  :log info "NetPulse: VPN tunnel ACTIVE"
} else={
  :put "  STATUS: NOT YET CONNECTED"
  :put "  Verify netpulse.co.ke:1194 is reachable"
  :log warning "NetPulse: VPN not yet connected"
}
:put "  Server:  netpulse.co.ke:1194/TCP"
:put "  RADIUS:  10.8.0.1:1812 (via VPN)"
:put "  Bridge:  NETPULSE (ether2 + PPPoE + Hotspot)"
:put "  PPPoE:   pool 10.0.10.1-254 on NETPULSE"
:put "  Hotspot: 192.168.10.1/24 on NETPULSE"
:put "======================================"
:put ""
:put "Check: /interface ovpn-client print"
:put "Check: /interface bridge port print"
:put "Check: /interface pppoe-server server print"
:put "Check: /ip hotspot print"
