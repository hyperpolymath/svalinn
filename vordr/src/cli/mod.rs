//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! Command-line interface for Vordr

use anyhow::Result;
use clap::{Parser, Subcommand};

pub mod exec;
pub mod images;
pub mod inspect;
pub mod network;
pub mod ps;
pub mod run;
pub mod volume;

/// Vordr - High-Assurance Daemonless Container Engine
#[derive(Parser, Debug)]
#[command(
    name = "vordr",
    author = "Svalinn Project",
    version,
    about = "High-assurance daemonless container engine with formally verified security",
    long_about = None
)]
pub struct Cli {
    /// Enable verbose output
    #[arg(short, long, global = true)]
    pub verbose: bool,

    /// Path to state database
    #[arg(
        long,
        global = true,
        default_value = "/var/lib/vordr/vordr.db",
        env = "VORDR_DB"
    )]
    pub db_path: String,

    /// Container runtime path (youki or runc)
    #[arg(
        long,
        global = true,
        default_value = "youki",
        env = "VORDR_RUNTIME"
    )]
    pub runtime: String,

    /// Root directory for container state
    #[arg(
        long,
        global = true,
        default_value = "/var/lib/vordr",
        env = "VORDR_ROOT"
    )]
    pub root: String,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Run a container from an image
    Run(run::RunArgs),

    /// Execute a command in a running container
    Exec(exec::ExecArgs),

    /// List containers
    Ps(ps::PsArgs),

    /// Display detailed information on a container
    Inspect(inspect::InspectArgs),

    /// Start a stopped container
    Start {
        /// Container ID or name
        container: String,
    },

    /// Stop a running container
    Stop {
        /// Container ID or name
        container: String,

        /// Seconds to wait before killing
        #[arg(short, long, default_value = "10")]
        timeout: u32,
    },

    /// Remove a container
    Rm {
        /// Container ID or name
        container: String,

        /// Force remove running container
        #[arg(short, long)]
        force: bool,
    },

    /// Manage images
    #[command(subcommand)]
    Image(images::ImageCommands),

    /// Manage networks
    #[command(subcommand)]
    Network(network::NetworkCommands),

    /// Manage volumes
    #[command(subcommand)]
    Volume(volume::VolumeCommands),

    /// Pull an image from a registry
    Pull {
        /// Image reference (e.g., alpine:latest)
        image: String,
    },

    /// Display system information
    Info,

    /// Show Vordr version
    Version,
}

/// Execute a CLI command
pub async fn execute(cli: Cli) -> Result<()> {
    match cli.command {
        Commands::Run(args) => run::execute(args, &cli).await,
        Commands::Exec(args) => exec::execute(args, &cli).await,
        Commands::Ps(args) => ps::execute(args, &cli).await,
        Commands::Inspect(args) => inspect::execute(args, &cli).await,
        Commands::Start { container } => start_container(&container, &cli).await,
        Commands::Stop { container, timeout } => stop_container(&container, timeout, &cli).await,
        Commands::Rm { container, force } => remove_container(&container, force, &cli).await,
        Commands::Image(cmd) => images::execute(cmd, &cli).await,
        Commands::Network(cmd) => network::execute(cmd, &cli).await,
        Commands::Volume(cmd) => volume::execute(cmd, &cli).await,
        Commands::Pull { image } => pull_image(&image, &cli).await,
        Commands::Info => show_info(&cli).await,
        Commands::Version => show_version(),
    }
}

async fn start_container(container: &str, cli: &Cli) -> Result<()> {
    use std::path::Path;
    use crate::engine::StateManager;

    let state = StateManager::open(Path::new(&cli.db_path))?;
    let info = state.get_container(container)?;

    println!("Starting container: {} ({})", info.name, info.id);
    // TODO: Implement actual start via runtime
    Ok(())
}

async fn stop_container(container: &str, timeout: u32, cli: &Cli) -> Result<()> {
    use std::path::Path;
    use crate::engine::StateManager;

    let state = StateManager::open(Path::new(&cli.db_path))?;
    let info = state.get_container(container)?;

    println!("Stopping container: {} (timeout: {}s)", info.name, timeout);
    // TODO: Implement actual stop via runtime
    Ok(())
}

async fn remove_container(container: &str, force: bool, cli: &Cli) -> Result<()> {
    use std::path::Path;
    use crate::engine::StateManager;

    let state = StateManager::open(Path::new(&cli.db_path))?;
    let info = state.get_container(container)?;

    if force {
        println!("Force removing container: {}", info.name);
    } else {
        println!("Removing container: {}", info.name);
    }

    state.delete_container(&info.id)?;
    Ok(())
}

async fn pull_image(image: &str, _cli: &Cli) -> Result<()> {
    println!("Pulling image: {}", image);
    // TODO: Implement registry client
    Ok(())
}

async fn show_info(_cli: &Cli) -> Result<()> {
    println!("Vordr Container Engine");
    println!("Version: {}", env!("CARGO_PKG_VERSION"));
    println!("Gatekeeper: {}", crate::ffi::gatekeeper_version());
    println!("Runtime: youki (default)");

    #[cfg(target_os = "linux")]
    {
        // Show kernel info
        if let Ok(output) = std::process::Command::new("uname")
            .args(["-r"])
            .output()
        {
            let kernel = String::from_utf8_lossy(&output.stdout);
            println!("Kernel: {}", kernel.trim());
        }
    }

    Ok(())
}

fn show_version() -> Result<()> {
    println!("vordr version {}", env!("CARGO_PKG_VERSION"));
    println!("gatekeeper version {}", crate::ffi::gatekeeper_version());
    Ok(())
}
