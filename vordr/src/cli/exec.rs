//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! `vordr exec` command implementation

use anyhow::{Context, Result};
use clap::Args;
use std::path::Path;

use crate::cli::Cli;
use crate::engine::{ContainerState, StateManager};

/// Arguments for the `exec` command
#[derive(Args, Debug)]
pub struct ExecArgs {
    /// Container ID or name
    pub container: String,

    /// Run in detached mode
    #[arg(short, long)]
    pub detach: bool,

    /// Set environment variables
    #[arg(short = 'e', long = "env", action = clap::ArgAction::Append)]
    pub env: Vec<String>,

    /// Allocate a pseudo-TTY
    #[arg(short = 't', long)]
    pub tty: bool,

    /// Keep STDIN open
    #[arg(short = 'i', long)]
    pub interactive: bool,

    /// Working directory inside the container
    #[arg(short = 'w', long)]
    pub workdir: Option<String>,

    /// Run as specific user
    #[arg(short = 'u', long)]
    pub user: Option<String>,

    /// Command and arguments to execute
    #[arg(required = true, trailing_var_arg = true)]
    pub command: Vec<String>,
}

pub async fn execute(args: ExecArgs, cli: &Cli) -> Result<()> {
    // Open state database
    let state = StateManager::open(Path::new(&cli.db_path))
        .context("Failed to open state database")?;

    // Get container info
    let container = state.get_container(&args.container)
        .context("Container not found")?;

    // Check container is running
    if container.state != ContainerState::Running {
        anyhow::bail!("Container {} is not running (state: {:?})",
            container.name, container.state);
    }

    println!("Executing in container: {} ({})", container.name, container.id);
    println!("Command: {:?}", args.command);

    if args.tty && args.interactive {
        println!("Mode: interactive with TTY");
    } else if args.detach {
        println!("Mode: detached");
    }

    // TODO: Implement actual exec via runtime shim
    println!("Exec not yet implemented - container runtime integration pending");

    Ok(())
}
