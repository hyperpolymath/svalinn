//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! `vordr run` command implementation

use anyhow::{Context, Result};
use clap::Args;
use std::path::Path;
use tracing::info;

use crate::cli::Cli;
use crate::engine::{ContainerState, StateManager};
use crate::ffi::{ConfigValidator, NetworkMode};

/// Arguments for the `run` command
#[derive(Args, Debug)]
pub struct RunArgs {
    /// Image to run
    pub image: String,

    /// Assign a name to the container
    #[arg(long)]
    pub name: Option<String>,

    /// Run container in the background
    #[arg(short, long)]
    pub detach: bool,

    /// Run as privileged container (bypasses security checks)
    #[arg(long)]
    pub privileged: bool,

    /// Set user ID
    #[arg(short, long)]
    pub user: Option<String>,

    /// Enable user namespace (default: true)
    #[arg(long, default_value = "true")]
    pub userns: bool,

    /// Add a capability
    #[arg(long = "cap-add", action = clap::ArgAction::Append)]
    pub cap_add: Vec<String>,

    /// Drop a capability
    #[arg(long = "cap-drop", action = clap::ArgAction::Append)]
    pub cap_drop: Vec<String>,

    /// Mount a volume
    #[arg(short = 'v', long = "volume", action = clap::ArgAction::Append)]
    pub volumes: Vec<String>,

    /// Set environment variables
    #[arg(short = 'e', long = "env", action = clap::ArgAction::Append)]
    pub env: Vec<String>,

    /// Working directory inside the container
    #[arg(short = 'w', long)]
    pub workdir: Option<String>,

    /// Connect to a network
    #[arg(long)]
    pub network: Option<String>,

    /// Publish a port (host:container)
    #[arg(short = 'p', long = "publish", action = clap::ArgAction::Append)]
    pub ports: Vec<String>,

    /// Read-only root filesystem
    #[arg(long)]
    pub read_only: bool,

    /// Disable network
    #[arg(long)]
    pub no_network: bool,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true)]
    pub command: Vec<String>,
}

pub async fn execute(args: RunArgs, cli: &Cli) -> Result<()> {
    info!("Running container from image: {}", args.image);

    // Parse user ID
    let user_id = if let Some(ref user) = args.user {
        user.parse::<u32>()
            .context("Invalid user ID")?
    } else {
        1000 // Default non-root user
    };

    // Build and validate configuration through the gatekeeper
    let network_mode = if args.no_network {
        NetworkMode::Unprivileged
    } else if args.privileged {
        NetworkMode::Admin
    } else {
        NetworkMode::Restricted
    };

    let mut validator = ConfigValidator::new()
        .privileged(args.privileged)
        .user_namespace(args.userns)
        .user_id(user_id)
        .network_mode(network_mode)
        .readonly_rootfs(args.read_only);

    // Add capabilities
    for cap in &args.cap_add {
        validator = validator.add_capability(cap);
    }

    // Validate through the formally verified gatekeeper
    let validated_config = validator.validate()
        .context("Security validation failed")?;

    info!("Configuration validated by gatekeeper");

    // Generate container ID and name
    let container_id = generate_container_id();
    let container_name = args.name.unwrap_or_else(|| generate_container_name());

    // Ensure state directory exists
    let root_path = Path::new(&cli.root);
    std::fs::create_dir_all(root_path)
        .context("Failed to create root directory")?;

    // Ensure database directory exists
    let db_path = Path::new(&cli.db_path);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .context("Failed to create database directory")?;
    }

    // Open state database
    let state = StateManager::open(db_path)
        .context("Failed to open state database")?;

    // Create bundle directory
    let bundle_path = root_path.join("containers").join(&container_id);
    std::fs::create_dir_all(&bundle_path)
        .context("Failed to create bundle directory")?;

    // TODO: Pull image if not present
    // For now, use a placeholder image ID
    let image_id = format!("sha256:{}", &container_id[..12]);

    // Check if image exists, create placeholder if not
    if state.get_image(&image_id).is_err() {
        state.create_image(
            &image_id,
            &format!("sha256:{}", hex::encode(&container_id.as_bytes()[..16])),
            Some(&args.image),
            &[args.image.clone()],
            0,
        )?;
    }

    // Create container record
    let config_json = serde_json::json!({
        "image": args.image,
        "command": args.command,
        "env": args.env,
        "volumes": args.volumes,
        "ports": args.ports,
        "privileged": validated_config.privileged,
        "user": user_id,
        "userns": validated_config.user_namespace,
    });

    state.create_container(
        &container_id,
        &container_name,
        &image_id,
        bundle_path.to_str().unwrap(),
        Some(&config_json.to_string()),
    ).context("Failed to create container record")?;

    info!("Created container {} ({})", container_name, container_id);

    if args.detach {
        // In detached mode, just print the container ID
        println!("{}", container_id);
    } else {
        // TODO: Actually start the container and attach
        println!("Container {} created", container_name);
        println!("ID: {}", container_id);

        // For now, simulate starting
        state.set_container_state(&container_id, ContainerState::Running, Some(std::process::id() as i32))?;
        println!("Status: Running (simulated)");
    }

    Ok(())
}

/// Generate a unique container ID (64 hex characters)
fn generate_container_id() -> String {
    use sha2::{Sha256, Digest};

    let mut hasher = Sha256::new();
    hasher.update(uuid::Uuid::new_v4().as_bytes());
    hasher.update(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_le_bytes());

    hex::encode(hasher.finalize())
}

/// Generate a random container name (adjective_noun format)
fn generate_container_name() -> String {
    let adjectives = [
        "brave", "calm", "eager", "fair", "gentle",
        "happy", "jolly", "kind", "lively", "merry",
        "nice", "proud", "quick", "sharp", "witty",
    ];
    let nouns = [
        "bear", "crane", "deer", "eagle", "falcon",
        "goose", "heron", "ibis", "jay", "kite",
        "lark", "myna", "owl", "panda", "quail",
    ];

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut hasher);
    let hash = hasher.finish();

    let adj = adjectives[(hash % adjectives.len() as u64) as usize];
    let noun = nouns[((hash >> 8) % nouns.len() as u64) as usize];

    format!("{}_{}", adj, noun)
}
