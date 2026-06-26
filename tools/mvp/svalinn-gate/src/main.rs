// SPDX-License-Identifier: MPL-2.0
// Copyright (c) Jonathan D.A. Jewell <j.d.a.jewell@open.ac.uk>
//! Svalinn MVP policy gate.
//!
//! Verifies a DSSE/in-toto attestation bundle against a policy and a trust
//! store before a container image is admitted. Ported faithfully from the
//! former `tools/mvp/svalinn_gate.py` (Python is banned by the estate
//! language policy; Rust is the go-to for CLI / systems tooling).
//!
//! Usage:
//!   svalinn-gate verify --bundle B --trust-store T --policy P \
//!       --image-digest sha256:HEX [--json]
//!
//! On success prints `ok` (or a JSON report with `--json`). On a policy
//! denial it prints the message to stderr (or a `{ "ok": false, "error": … }`
//! envelope to stdout with `--json`) and exits 1.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

const PAYLOAD_TYPE: &str = "application/vnd.in-toto+json";

/// A structured policy-denial — mirrors the Python `GateError`. Rendered as
/// the `{ "ok": false, "error": { id, message, details } }` JSON envelope.
struct GateError {
    message: String,
    error_id: &'static str,
    details: Value,
}

impl GateError {
    fn new(message: impl Into<String>, error_id: &'static str, details: Value) -> Self {
        GateError { message: message.into(), error_id, details }
    }
}

/// Either a structured policy denial (`GateError` → JSON envelope) or any
/// other fatal error (IO / parse / openssl), which mirrors the Python
/// script's uncaught-exception path: message to stderr, exit 1.
enum AppError {
    Gate(GateError),
    Other(String),
}

impl From<GateError> for AppError {
    fn from(e: GateError) -> Self {
        AppError::Gate(e)
    }
}

type R<T> = Result<T, AppError>;

fn fail<T>(msg: impl Into<String>) -> R<T> {
    Err(AppError::Other(msg.into()))
}

// ---- DSSE PAE -------------------------------------------------------------

/// Pre-Authentication Encoding, byte-for-byte as the Python `dsse_pae`:
/// `DSSEv1 <len(type)> <type> <len(payload_b64)> <payload_b64>`.
/// NB: the second segment is the *base64 string* bytes, matching the original.
fn dsse_pae(payload_type: &str, payload_b64: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"DSSEv1 ");
    let pt = payload_type.as_bytes();
    out.extend_from_slice(pt.len().to_string().as_bytes());
    out.push(b' ');
    out.extend_from_slice(pt);
    out.push(b' ');
    let pb = payload_b64.as_bytes();
    out.extend_from_slice(pb.len().to_string().as_bytes());
    out.push(b' ');
    out.extend_from_slice(pb);
    out
}

// ---- openssl shelling -----------------------------------------------------

fn require_openssl() -> R<()> {
    match Command::new("openssl")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(s) if s.success() => Ok(()),
        _ => fail("openssl not found; required for MVP signature verification"),
    }
}

fn b64_decode(s: &str) -> R<Vec<u8>> {
    B64.decode(s.as_bytes())
        .map_err(|e| AppError::Other(format!("base64 decode failed: {e}")))
}

fn verify_signature(pub_key_b64: &str, payload_b64: &str, signature_b64: &str) -> R<()> {
    let payload_bytes = dsse_pae(PAYLOAD_TYPE, payload_b64);
    let pub_der = b64_decode(pub_key_b64)?;
    let signature = b64_decode(signature_b64)?;

    let temp_dir = std::env::temp_dir().join(format!("svalinn-gate-{}", std::process::id()));
    fs::create_dir_all(&temp_dir).map_err(|e| AppError::Other(format!("tempdir: {e}")))?;
    let pub_path = temp_dir.join("pub.der");
    let sig_path = temp_dir.join("sig.bin");

    let cleanup = |d: &Path| {
        let _ = fs::remove_dir_all(d);
    };

    if let Err(e) = fs::write(&pub_path, &pub_der) {
        cleanup(&temp_dir);
        return fail(format!("write pub: {e}"));
    }
    if let Err(e) = fs::write(&sig_path, &signature) {
        cleanup(&temp_dir);
        return fail(format!("write sig: {e}"));
    }

    let spawn = Command::new("openssl")
        .args(["pkeyutl", "-verify", "-pubin", "-inkey"])
        .arg(&pub_path)
        .args(["-inform", "DER", "-rawin", "-sigfile"])
        .arg(&sig_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn {
        Ok(c) => c,
        Err(e) => {
            cleanup(&temp_dir);
            return fail(format!("openssl spawn: {e}"));
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(&payload_bytes);
        // stdin dropped here → EOF, so openssl can finish.
    }
    let status = child.wait();
    cleanup(&temp_dir);
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => fail("openssl signature verification failed"),
        Err(e) => fail(format!("openssl wait: {e}")),
    }
}

// ---- JSON helpers ---------------------------------------------------------

fn load_json(path: &str) -> R<Value> {
    let text = fs::read_to_string(path).map_err(|e| AppError::Other(format!("read {path}: {e}")))?;
    serde_json::from_str(&text).map_err(|e| AppError::Other(format!("parse {path}: {e}")))
}

fn decode_statement(payload_b64: &str) -> R<Value> {
    let raw = b64_decode(payload_b64)?;
    let text = String::from_utf8(raw).map_err(|e| AppError::Other(format!("payload utf8: {e}")))?;
    serde_json::from_str(&text).map_err(|e| AppError::Other(format!("payload json: {e}")))
}

/// Flatten `trustStore.keys` (a map of role → [entry]) into id → publicKey(b64).
fn trust_store_keys(trust_store: &Value) -> BTreeMap<String, String> {
    let mut keys = BTreeMap::new();
    if let Some(obj) = trust_store.get("keys").and_then(|v| v.as_object()) {
        for role_keys in obj.values() {
            if let Some(arr) = role_keys.as_array() {
                for entry in arr {
                    let id = entry.get("id").and_then(|v| v.as_str());
                    let pk = entry.get("publicKey").and_then(|v| v.as_str());
                    if let (Some(id), Some(pk)) = (id, pk) {
                        keys.insert(id.to_string(), pk.to_string());
                    }
                }
            }
        }
    }
    keys
}

fn sanity_check_bundle(bundle: &Value) -> R<()> {
    if bundle.get("mediaType").and_then(|v| v.as_str())
        != Some("application/vnd.verified-container.bundle+json")
    {
        return Err(GateError::new("invalid mediaType", "ERR_POLICY_DENIED", json!({"field": "mediaType"})).into());
    }
    if bundle.get("version").and_then(|v| v.as_str()) != Some("0.1.0") {
        return Err(GateError::new("unsupported bundle version", "ERR_POLICY_DENIED", json!({"field": "version"})).into());
    }
    let attestations_ok = bundle.get("attestations").and_then(|v| v.as_array()).is_some_and(|a| !a.is_empty());
    if !attestations_ok {
        return Err(GateError::new("attestations required", "ERR_POLICY_DENIED", json!({"field": "attestations"})).into());
    }
    let log_entries_ok = bundle.get("logEntries").and_then(|v| v.as_array()).is_some_and(|a| !a.is_empty());
    if !log_entries_ok {
        return Err(GateError::new("logEntries required", "ERR_POLICY_DENIED", json!({"field": "logEntries"})).into());
    }
    Ok(())
}

fn verify_policy(bundle: &Value, policy: &Value, trust_store: &Value, image_digest: &str) -> R<Value> {
    let required_predicates: BTreeSet<String> = match policy.get("requiredPredicates").and_then(|v| v.as_array()) {
        Some(arr) => arr.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        None => return fail("policy.requiredPredicates missing or not a list"),
    };
    let allowed_signers: BTreeSet<String> = match policy.get("allowedSigners").and_then(|v| v.as_array()) {
        Some(arr) => arr.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        None => return fail("policy.allowedSigners missing or not a list"),
    };
    let log_quorum = policy.get("logQuorum").and_then(|v| v.as_u64()).unwrap_or(1);

    sanity_check_bundle(bundle)?;

    let keys = trust_store_keys(trust_store);

    let mut log_ids: BTreeSet<String> = BTreeSet::new();
    if let Some(entries) = bundle.get("logEntries").and_then(|v| v.as_array()) {
        for entry in entries {
            if let Some(id) = entry.get("logId").and_then(|v| v.as_str()) {
                log_ids.insert(id.to_string());
            }
        }
    }
    if (log_ids.len() as u64) < log_quorum {
        return Err(GateError::new(
            "log quorum not satisfied",
            "ERR_POLICY_DENIED",
            json!({"required": log_quorum, "observed": log_ids.len()}),
        )
        .into());
    }
    let logs_obj = trust_store.get("logs").and_then(|v| v.as_object());
    for log_id in &log_ids {
        let known = logs_obj.is_some_and(|m| m.contains_key(log_id));
        if !known {
            return Err(GateError::new("unknown log operator", "ERR_POLICY_DENIED", json!({"logId": log_id})).into());
        }
    }

    let mut seen_predicates: BTreeSet<String> = BTreeSet::new();
    let mut seen_signers: BTreeSet<String> = BTreeSet::new();
    let mut missing_subjects: Vec<String> = Vec::new();

    if let Some(attestations) = bundle.get("attestations").and_then(|v| v.as_array()) {
        for attestation in attestations {
            let payload_b64 = match attestation.get("payload").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return fail("attestation.payload missing"),
            };
            let statement = decode_statement(payload_b64)?;
            if let Some(pt) = statement.get("predicateType").and_then(|v| v.as_str()) {
                seen_predicates.insert(pt.to_string());
            }
            if let Some(subjects) = statement.get("subject").and_then(|v| v.as_array()) {
                for subject in subjects {
                    let digest = subject
                        .get("digest")
                        .and_then(|d| d.get("sha256"))
                        .and_then(|v| v.as_str());
                    if let Some(digest) = digest {
                        if format!("sha256:{digest}") != image_digest {
                            missing_subjects.push(digest.to_string());
                        }
                    }
                }
            }

            let mut valid_signature = false;
            if let Some(sigs) = attestation.get("signatures").and_then(|v| v.as_array()) {
                for signature in sigs {
                    let key_id = signature.get("keyid").and_then(|v| v.as_str());
                    if let Some(kid) = key_id {
                        seen_signers.insert(kid.to_string());
                        if allowed_signers.contains(kid) {
                            if let Some(pubkey) = keys.get(kid) {
                                let sig = signature.get("sig").and_then(|v| v.as_str()).unwrap_or("");
                                verify_signature(pubkey, payload_b64, sig)?;
                                valid_signature = true;
                                break;
                            }
                        }
                    }
                }
            }
            if !valid_signature {
                let allowed: Vec<&String> = allowed_signers.iter().collect();
                let seen: Vec<&String> = seen_signers.iter().collect();
                return Err(GateError::new(
                    "no valid signature for allowed signer",
                    "ERR_POLICY_DENIED",
                    json!({"allowed": allowed, "seen": seen}),
                )
                .into());
            }
        }
    }

    if !missing_subjects.is_empty() {
        return Err(GateError::new(
            "subject digest mismatch",
            "ERR_POLICY_DENIED",
            json!({"expected": image_digest, "observed": missing_subjects}),
        )
        .into());
    }

    let missing_predicates: Vec<&String> = required_predicates.difference(&seen_predicates).collect();
    if !missing_predicates.is_empty() {
        return Err(GateError::new(
            "missing required predicates",
            "ERR_POLICY_DENIED",
            json!({"missing": missing_predicates}),
        )
        .into());
    }

    Ok(json!({
        "predicates": seen_predicates.iter().collect::<Vec<_>>(),
        "signers": seen_signers.iter().collect::<Vec<_>>(),
        "logIds": log_ids.iter().collect::<Vec<_>>(),
    }))
}

// ---- CLI ------------------------------------------------------------------

struct VerifyOpts {
    bundle: String,
    trust_store: String,
    policy: String,
    image_digest: String,
    json: bool,
}

fn parse_verify(args: &[String]) -> Result<VerifyOpts, String> {
    let mut bundle = None;
    let mut trust_store = None;
    let mut policy = None;
    let mut image_digest = None;
    let mut json = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--bundle" => {
                i += 1;
                bundle = args.get(i).cloned();
            }
            "--trust-store" => {
                i += 1;
                trust_store = args.get(i).cloned();
            }
            "--policy" => {
                i += 1;
                policy = args.get(i).cloned();
            }
            "--image-digest" => {
                i += 1;
                image_digest = args.get(i).cloned();
            }
            "--json" => json = true,
            unknown => return Err(format!("unrecognized argument: {unknown}")),
        }
        i += 1;
    }
    Ok(VerifyOpts {
        bundle: bundle.ok_or("--bundle is required")?,
        trust_store: trust_store.ok_or("--trust-store is required")?,
        policy: policy.ok_or("--policy is required")?,
        image_digest: image_digest.ok_or("--image-digest is required")?,
        json,
    })
}

fn command_verify(opts: &VerifyOpts) -> R<()> {
    require_openssl()?;
    let bundle = load_json(&opts.bundle)?;
    let trust_store = load_json(&opts.trust_store)?;
    let policy = load_json(&opts.policy)?;
    let report = verify_policy(&bundle, &policy, &trust_store, &opts.image_digest)?;
    if opts.json {
        let out = json!({"ok": true, "report": report});
        println!("{}", serde_json::to_string_pretty(&out).expect("serialize report"));
    } else {
        println!("ok");
    }
    Ok(())
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let json_mode = argv.iter().any(|a| a == "--json");

    let result: R<()> = match argv.first().map(String::as_str) {
        Some("verify") => match parse_verify(&argv[1..]) {
            Ok(opts) => command_verify(&opts),
            Err(msg) => Err(AppError::Other(msg)),
        },
        Some(cmd) => Err(AppError::Other(format!("unknown command: {cmd}"))),
        None => Err(AppError::Other("a subcommand is required (verify)".to_string())),
    };

    if let Err(e) = result {
        match e {
            AppError::Gate(g) => {
                if json_mode {
                    let payload = json!({
                        "ok": false,
                        "error": { "id": g.error_id, "message": g.message, "details": g.details },
                    });
                    println!("{}", serde_json::to_string_pretty(&payload).expect("serialize error"));
                } else {
                    eprintln!("{}", g.message);
                }
            }
            AppError::Other(msg) => eprintln!("{msg}"),
        }
        std::process::exit(1);
    }
}
