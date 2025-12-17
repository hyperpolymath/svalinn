//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! Security validation utilities for container engine

use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ValidationError {
    #[error("Invalid name: {0}")]
    InvalidName(String),
    #[error("Path traversal detected: {0}")]
    PathTraversal(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Symlink not allowed: {0}")]
    SymlinkNotAllowed(String),
}

/// Validate a resource name (container, network, volume)
/// Names must be alphanumeric with underscores and hyphens only.
/// Maximum length of 64 characters.
pub fn validate_resource_name(name: &str) -> Result<(), ValidationError> {
    if name.is_empty() {
        return Err(ValidationError::InvalidName(
            "Name cannot be empty".to_string(),
        ));
    }

    if name.len() > 64 {
        return Err(ValidationError::InvalidName(
            "Name exceeds maximum length of 64 characters".to_string(),
        ));
    }

    // Must start with alphanumeric
    if !name
        .chars()
        .next()
        .map(|c| c.is_ascii_alphanumeric())
        .unwrap_or(false)
    {
        return Err(ValidationError::InvalidName(
            "Name must start with a letter or number".to_string(),
        ));
    }

    // Only allow alphanumeric, underscore, hyphen, and dot
    for ch in name.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' && ch != '.' {
            return Err(ValidationError::InvalidName(format!(
                "Invalid character '{}' in name",
                ch
            )));
        }
    }

    // Check for path traversal attempts
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(ValidationError::PathTraversal(
            "Name contains path traversal sequences".to_string(),
        ));
    }

    Ok(())
}

/// Validate that a path is safe to use for filesystem operations.
/// Checks for symlinks and ensures path is within expected root.
pub fn validate_path_safe(path: &Path, expected_root: &Path) -> Result<(), ValidationError> {
    // Check path doesn't contain obvious traversal
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err(ValidationError::PathTraversal(format!(
            "Path contains '..' traversal: {}",
            path_str
        )));
    }

    // If path exists, check it's not a symlink
    if path.exists() && path.is_symlink() {
        return Err(ValidationError::SymlinkNotAllowed(format!(
            "Path is a symlink: {}",
            path_str
        )));
    }

    // Attempt to canonicalize and verify it's within expected root
    if path.exists() {
        match path.canonicalize() {
            Ok(canonical) => {
                if let Ok(root_canonical) = expected_root.canonicalize() {
                    if !canonical.starts_with(&root_canonical) {
                        return Err(ValidationError::PathTraversal(format!(
                            "Path escapes expected root directory: {}",
                            canonical.display()
                        )));
                    }
                }
            }
            Err(e) => {
                return Err(ValidationError::InvalidPath(format!(
                    "Failed to canonicalize path: {}",
                    e
                )));
            }
        }
    }

    Ok(())
}

/// Safely convert a path to string, returning error instead of panicking
pub fn path_to_string(path: &Path) -> Result<String, ValidationError> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| ValidationError::InvalidPath("Path contains invalid UTF-8".to_string()))
}

/// Check if a path is a symlink before performing destructive operations
pub fn check_not_symlink(path: &Path) -> Result<(), ValidationError> {
    // Use symlink_metadata to check without following the link
    match path.symlink_metadata() {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(ValidationError::SymlinkNotAllowed(format!(
                    "Cannot operate on symlink: {}",
                    path.display()
                )));
            }
            Ok(())
        }
        Err(_) => {
            // Path doesn't exist, which is fine for some operations
            Ok(())
        }
    }
}

/// Validate an image reference for safe use
pub fn validate_image_reference(reference: &str) -> Result<(), ValidationError> {
    if reference.is_empty() {
        return Err(ValidationError::InvalidName(
            "Image reference cannot be empty".to_string(),
        ));
    }

    // Check for dangerous characters
    if reference.contains(';')
        || reference.contains('|')
        || reference.contains('`')
        || reference.contains('$')
    {
        return Err(ValidationError::InvalidName(
            "Image reference contains disallowed characters".to_string(),
        ));
    }

    Ok(())
}

/// Validate a SHA256 digest format
pub fn validate_sha256_digest(digest: &str) -> Result<(), ValidationError> {
    if !digest.starts_with("sha256:") {
        return Err(ValidationError::InvalidName(
            "Digest must start with 'sha256:'".to_string(),
        ));
    }

    let hex_part = &digest[7..];
    if hex_part.len() != 64 {
        return Err(ValidationError::InvalidName(
            "SHA256 digest must be exactly 64 hex characters".to_string(),
        ));
    }

    if !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidName(
            "SHA256 digest must contain only hex characters".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_resource_names() {
        assert!(validate_resource_name("my-container").is_ok());
        assert!(validate_resource_name("my_volume").is_ok());
        assert!(validate_resource_name("container123").is_ok());
        assert!(validate_resource_name("a").is_ok());
    }

    #[test]
    fn test_invalid_resource_names() {
        assert!(validate_resource_name("").is_err());
        assert!(validate_resource_name("../escape").is_err());
        assert!(validate_resource_name("/absolute").is_err());
        assert!(validate_resource_name("has space").is_err());
        assert!(validate_resource_name("-starts-dash").is_err());
        assert!(validate_resource_name("a".repeat(65).as_str()).is_err());
    }

    #[test]
    fn test_sha256_validation() {
        let valid = "sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4";
        assert!(validate_sha256_digest(valid).is_ok());

        assert!(validate_sha256_digest("sha256:abc").is_err()); // Too short
        assert!(validate_sha256_digest("md5:abc").is_err()); // Wrong prefix
        assert!(validate_sha256_digest("sha256:gggg").is_err()); // Invalid hex
    }
}
