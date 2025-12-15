//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! Vordr - High-Assurance Daemonless Container Engine
//!
//! The Warden component of the Svalinn ecosystem.
//! Provides secure container execution with formally verified security policies.

use anyhow::Result;
use clap::Parser;
use tracing::info;
use tracing_subscriber::{fmt, EnvFilter};

mod cli;
mod engine;
mod ffi;
mod network;
mod registry;
mod runtime;

use cli::{Cli, Commands};

fn main() -> Result<()> {
    // Initialize logging
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    // Initialize the gatekeeper
    ffi::init_gatekeeper()?;
    info!("Gatekeeper initialized (version {})", ffi::gatekeeper_version());

    // Parse CLI arguments
    let cli = Cli::parse();

    // Execute command
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async { cli::execute(cli).await })
}
