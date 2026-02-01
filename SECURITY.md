# Security Policy

## Current Security Posture (2026-01-28)

**Svalinn-Project Compliance**: 20%

Svalinn is a Deno-based HTTP gateway under active security development. This document describes our current security status, implemented features, and known limitations.

### Implemented Features ✅

| Component | Status | Standard | Notes |
|-----------|--------|----------|-------|
| **OAuth2 / OIDC** | ✅ Production | RFC 6749, OpenID Connect | Token validation, JWKS caching |
| **JWT Verification** | ✅ Production | RFC 7519 | Web Crypto API |
| **API Key Auth** | ✅ Production | Custom | Bearer token authentication |
| **mTLS** | ✅ Production | TLS 1.3 | Mutual TLS client certificates |
| **JSON Schema Validation** | ✅ Production | Ajv | Request payload validation |
| **Security Headers** | ✅ Production | OWASP | HSTS, CSP, X-Frame-Options, etc. |
| **TLS 1.3** | ✅ Production | RFC 8446 | Via Deno (BoringSSL) |
| **CORS** | ✅ Production | W3C CORS | Configurable origin allowlist |
| **Structured Logging** | ✅ Production | JSON | Security event logging |

### Security Configurations Created (Awaiting Deployment) ⚠️

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| **OWASP ModSecurity CRS** | ⚠️ Config Only | `config/modsecurity/` | OWASP Top 10 defenses, needs nginx/Apache |
| **Firewalld Zones** | ⚠️ Config Only | `config/firewalld/zones/` | svalinn-edge.xml, svalinn-internal.xml |
| **Security Headers Middleware** | ⚠️ Code Ready | `src/middleware/SecurityHeaders.res` | Needs integration in Gateway.res |

### Missing Features (Deno Limitations) ❌

| Component | Priority | Blocker | Timeline |
|-----------|----------|---------|----------|
| **PQ-TLS (Kyber-1024)** | CRITICAL | Deno uses BoringSSL (no PQ support) | 6-12 months (wait for Deno) or 2-3 months (Rust rewrite) |
| **QUIC / HTTP/3** | HIGH | Deno QUIC support pending | 6-12 months (track [Deno #9900](https://github.com/denoland/deno/issues/9900)) |
| **XChaCha20-Poly1305** | MEDIUM | Deno Web Crypto doesn't expose XChaCha20 | 2-3 days (use libsodium-wrappers) |
| **HKDF-SHAKE512** | MEDIUM | Web Crypto has HKDF-SHA256/512 only | 1-2 days (custom implementation) |

**IMPORTANT**: Post-quantum TLS is CRITICAL for svalinn-project compliance but blocked by Deno's crypto backend. Options:
1. Wait for Deno to integrate OQS-BoringSSL (6-12 months)
2. Rewrite Svalinn in Rust with Hyper + Rustls + liboqs (2-3 months)
3. Put nginx with OQS-OpenSSL in front of Svalinn (1-2 weeks)

---

## Supported Versions

| Version | Supported | Notes |
|---------|-----------|-------|
| `main` branch | ✅ Yes | Latest development |
| v0.2.0-rc1 | ✅ Yes | Production ready (95% complete) |
| Earlier versions | ❌ No | Pre-production |

---

## Reporting a Vulnerability

### Preferred Method: GitHub Security Advisories

1. Navigate to [Report a Vulnerability](https://github.com/hyperpolymath/svalinn/security/advisories/new)
2. Click **"Report a vulnerability"**
3. Complete the form with as much detail as possible
4. Submit — we'll receive a private notification

### Alternative: Email

| | |
|---|---|
| **Email** | jonathan.jewell@open.ac.uk |
| **Subject Line** | `[SECURITY] Svalinn: <brief description>` |

> **⚠️ Important:** Do not report security vulnerabilities through public GitHub issues or discussions.

---

## Response Timeline

| Stage | Timeframe | Description |
|-------|-----------|-------------|
| **Initial Response** | 48 hours | We acknowledge receipt and confirm we're investigating |
| **Triage** | 7 days | We assess severity, confirm the vulnerability, and estimate timeline |
| **Status Update** | Every 7 days | Regular updates on remediation progress |
| **Resolution** | 90 days | Target for fix development and release |
| **Disclosure** | 90 days | Public disclosure after fix is available (coordinated with you) |

---

## Security Considerations for Svalinn

As an HTTP gateway for verified container operations, Svalinn has specific security requirements:

### Authentication & Authorization
- OAuth2 / OIDC flows with token refresh
- JWT signature verification (RS256, ES256)
- API key authentication with configurable scopes
- mTLS for machine-to-machine authentication
- RBAC planned (not yet implemented)

### Input Validation
- JSON Schema validation for all requests (Ajv)
- Gatekeeper policy format validation
- URL validation (SSRF prevention planned)
- Request size limits

### Transport Security
- TLS 1.3 enforced (Deno default)
- HSTS with preload directive
- Strong cipher suites (BoringSSL defaults)
- **No PQ-TLS yet** (Deno limitation)

### Web Application Security (OWASP Top 10 2021)

| Risk | Defense | Status |
|------|---------|--------|
| A01: Broken Access Control | OAuth2/JWT + RBAC planned | ⚠️ Partial |
| A02: Cryptographic Failures | TLS 1.3 + strong ciphers | ⚠️ No PQ-TLS |
| A03: Injection | JSON Schema validation | ✅ Implemented |
| A04: Insecure Design | Threat modeling + spec | ✅ Implemented |
| A05: Security Misconfiguration | Security headers + CSP | ✅ Implemented |
| A06: Vulnerable Components | Dependabot + Deno audit | ✅ Implemented |
| A07: Identification Failures | OAuth2 + MFA planned | ⚠️ No MFA |
| A08: Software Integrity Failures | SBOM + Sigstore planned | ⚠️ Planned |
| A09: Logging Failures | Structured logging + SIEM planned | ⚠️ No SIEM |
| A10: SSRF | URL validation planned | ❌ Not implemented |

### ModSecurity Integration (Deployment Required)

We've created OWASP ModSecurity Core Rule Set (CRS) configurations in `config/modsecurity/`:

**Defenses Configured:**
- SQL injection detection and blocking
- XSS attack detection
- SSRF prevention (localhost/private IP blocking)
- Rate limiting (100 req/min per IP)
- Request size limits
- Suspicious header detection

**Deployment Options:**
1. **Nginx with ModSecurity**: Put nginx in front of Svalinn, load ModSecurity module
2. **Apache with mod_security2**: Use Apache as reverse proxy
3. **Cloudflare WAF**: Use Cloudflare's managed WAF (commercial)

**Deployment Required**: ModSecurity is not yet active. Configs are ready but need web server integration.

### Firewalld Integration (Deployment Required)

We've created firewalld zone configurations in `config/firewalld/zones/`:

**Zones:**
- `svalinn-edge.xml`: Public-facing HTTPS gateway (ports 80, 443)
- `svalinn-internal.xml`: Internal service communication (MCP to Vörðr)

**Deployment Steps:**
```bash
# Copy zone files
sudo cp config/firewalld/zones/*.xml /etc/firewalld/zones/

# Reload firewalld
sudo firewall-cmd --reload

# Assign interface to zone
sudo firewall-cmd --zone=svalinn-edge --add-interface=eth0 --permanent
```

---

## Known Security Limitations

### CRITICAL Limitations

1. **No Post-Quantum TLS**
   - Uses classical TLS 1.3 (RSA/ECDHE key exchange)
   - Session keys vulnerable to future quantum computers
   - **Mitigation Options**:
     - Wait for Deno PQ-TLS support (6-12 months)
     - Rewrite in Rust with liboqs (2-3 months)
     - Nginx PQ-TLS frontend (1-2 weeks)

### HIGH Limitations

1. **No QUIC / HTTP/3**
   - Uses HTTP/2 (1-RTT TLS handshake vs 0-RTT with QUIC)
   - Head-of-line blocking on lossy networks
   - **Mitigation**: Track Deno issue #9900

2. **ModSecurity Not Deployed**
   - WAF configs created but not active
   - No OWASP Top 10 runtime protection yet
   - **Fix**: Deploy nginx with ModSecurity (1-2 weeks)

### MEDIUM Limitations

1. **No SSRF Protection**
   - URL validation not implemented
   - Could allow server-side request forgery attacks
   - **Fix**: Add URL allowlist validation (2-3 days)

2. **No RBAC**
   - JWT verification works but no role-based access control
   - All authenticated users have same permissions
   - **Fix**: Implement role/scope checking (1 week)

3. **No MFA**
   - OAuth2 works but no multi-factor authentication
   - Single factor (password/token) only
   - **Fix**: Add TOTP/WebAuthn support (2-3 weeks)

---

## Security Best Practices for Operators

When deploying Svalinn in production:

### Infrastructure
- Deploy behind nginx with OWASP ModSecurity enabled
- Configure firewalld zones with principle of least privilege
- Use TLS 1.3 with strong ciphers only
- Enable HSTS with preload directive
- Isolate in Kubernetes namespace or Docker network

### Authentication
- Use OAuth2 / OIDC for human users
- Use mTLS for machine-to-machine (Vörðr communication)
- Rotate API keys regularly (90 days recommended)
- Store secrets in vault (HashiCorp Vault, Kubernetes Secrets)
- Enable MFA when support is added

### Monitoring
- Forward logs to SIEM (Splunk, ELK, Datadog)
- Alert on authentication failures (5+ in 5 minutes)
- Alert on rate limit violations
- Monitor ModSecurity blocks
- Track certificate expiration

### Updates
- Subscribe to GitHub security advisories
- Apply security patches within 7 days
- Test updates in staging first
- Keep Deno runtime updated

---

## Disclosure Policy

We follow **coordinated disclosure** (responsible disclosure):

1. **You report** the vulnerability privately
2. **We acknowledge** and begin investigation (48 hours)
3. **We develop** a fix and prepare a release
4. **We coordinate** disclosure timing with you
5. **We publish** security advisory and fix simultaneously
6. **You may publish** your research after disclosure

### Our Commitments

- We will not take legal action against researchers who follow this policy
- We will work with you to understand and resolve the issue
- We will credit you in the security advisory (unless you prefer anonymity)
- We will notify you before public disclosure

### Your Commitments

- Report vulnerabilities promptly after discovery
- Give us reasonable time to address the issue (90 days)
- Do not access, modify, or delete data beyond proof-of-concept
- Do not share vulnerability details until coordinated disclosure

---

## Security Contact

| Purpose | Contact |
|---------|---------|
| **Security issues** | [Report via GitHub](https://github.com/hyperpolymath/svalinn/security/advisories/new) or jonathan.jewell@open.ac.uk |
| **Security questions** | [GitHub Discussions](https://github.com/hyperpolymath/svalinn/discussions) |
| **General questions** | See [README.adoc](README.adoc) for contact information |

---

## Related Documentation

- [DEPLOYMENT.adoc](DEPLOYMENT.adoc) - Production deployment guide (includes security hardening)
- [TESTING.adoc](TESTING.adoc) - Security testing procedures
- [ROADMAP.adoc](ROADMAP.adoc) - Security feature roadmap
- [Cerro Torre MISSING-SECURITY-COMPONENTS.adoc](https://github.com/hyperpolymath/cerro-torre/blob/main/docs/MISSING-SECURITY-COMPONENTS.adoc) - Ecosystem security audit

---

*Thank you for helping keep Svalinn and its users safe.* 🛡️

---

<sub>Last updated: 2026-01-28 · Policy version: 1.0.0 · v0.2.0-rc1 Status</sub>
