<!--
SPDX-License-Identifier: MPL-2.0
Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
-->

# Audit: JWT decode in test + bench context

**Auditor**: Jonathan D.A. Jewell
**Date**: 2026-05-26
**Scope**: 4 `panic-attack assail` PA022 CryptoMisuse findings flagging `jose decodeJwt()` calls without a paired `jwtVerify()` in test and benchmark files.
**Cross-reference**: campaign tracker [hyperpolymath/panic-attack#32](https://github.com/hyperpolymath/panic-attack/issues/32).
**Registry**: `audits/assail-classifications.a2ml`.

## Detector rule

panic-attack PA022 (`CryptoMisuse`) flags `jose.decodeJwt()` / `jwt.decode()` calls that have no `jwtVerify()` / `jwt.verify()` in the same module. In production code this is a real bug — `decodeJwt` returns the claims payload without checking the signature, so an attacker controlling the token can forge claims.

The same rule reports findings against test fixtures and benchmarks that *exercise the decode path itself*. Those are legitimate.

## §1 — `src/benches/svalinn_bench.ts`

```ts
Deno.bench("JWT decode valid token", () => {
  Jwt.decodeJwt(VALID_TOKEN);
});
```

The bench measures decode performance only. Substituting `jwtVerify` would shift the measurement onto signature verification, which is a separate concern and benchmarked elsewhere if needed.

**Classification**: legitimate (test-context-fixture, perf measurement of decode path).

## §2 — `src/tests/IntegrationTests.test.ts`

Integration test constructs JWTs under a known signing key, then decodes to assert the claim shape. The signing/verifying side of the contract is exercised by separate tests; the decode-only assertions are about structural correctness post-decode (`exp`, `iat`, custom claims).

**Classification**: legitimate (test-context-fixture, decodes tokens the same test produced).

## §3 — `src/tests/PropertyTests.test.ts`

Property-based tests inspect the JWT structure (header / payload / signature segments, base64 decoding, claim ranges) without enforcing signature validity — that is a different property covered in its own test.

**Classification**: legitimate (test-context-fixture, structural property under known-good fixture key).

## §4 — `src/tests/AuthTest.res.mjs`

Compiled-from-ReScript auth test. The `.res.mjs` extension marks it as ReScript codegen output committed for trace stability; the source is the `.res` file in the same directory. The decode is against tokens produced inside the same fixture.

**Classification**: legitimate (test-context-fixture, compiled test code).

## Outcome

All four findings are classified as `test-context-fixture` in `audits/assail-classifications.a2ml`. The next `panic-attack assail .` pass over svalinn will mark them `suppressed: true`, leaving any **new** decodeJwt-without-jwtVerify usage in production code visible.
