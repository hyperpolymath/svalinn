//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! Container engine core functionality

pub mod config;
pub mod lifecycle;
pub mod state;
pub mod validation;

pub use config::OciConfigBuilder;
pub use lifecycle::ContainerLifecycle;
pub use state::{ContainerInfo, ContainerState, ImageInfo, NetworkInfo, StateError, StateManager, VolumeInfo};
pub use validation::{
    check_not_symlink, path_to_string, validate_image_reference, validate_path_safe,
    validate_resource_name, validate_sha256_digest, ValidationError,
};
