//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! Container lifecycle management

use std::path::{Path, PathBuf};
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::engine::{ContainerInfo, ContainerState, StateManager};
use crate::ffi::ValidatedConfig;
use crate::runtime::ShimClient;

#[derive(Error, Debug)]
pub enum LifecycleError {
    #[error("Container not found: {0}")]
    NotFound(String),
    #[error("Container already exists: {0}")]
    AlreadyExists(String),
    #[error("Invalid state transition: {from:?} -> {to:?}")]
    InvalidTransition {
        from: ContainerState,
        to: ContainerState,
    },
    #[error("Runtime error: {0}")]
    Runtime(String),
    #[error("State error: {0}")]
    State(#[from] crate::engine::StateError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Config error: {0}")]
    Config(#[from] crate::engine::config::ConfigError),
}

/// Container lifecycle manager
pub struct ContainerLifecycle {
    state: StateManager,
    root_dir: PathBuf,
    runtime_path: String,
}

impl ContainerLifecycle {
    /// Create a new lifecycle manager
    pub fn new(db_path: &Path, root_dir: &Path, runtime: &str) -> Result<Self, LifecycleError> {
        std::fs::create_dir_all(root_dir)?;

        let state = StateManager::open(db_path)?;

        Ok(Self {
            state,
            root_dir: root_dir.to_path_buf(),
            runtime_path: runtime.to_string(),
        })
    }

    /// Create a new container
    pub fn create(
        &self,
        id: &str,
        name: &str,
        image_id: &str,
        config: &ValidatedConfig,
        command: Option<Vec<String>>,
    ) -> Result<ContainerInfo, LifecycleError> {
        info!("Creating container {} ({})", name, id);

        // Create bundle directory
        let bundle_path = self.root_dir.join("containers").join(id);
        std::fs::create_dir_all(&bundle_path)?;

        // Create rootfs directory (will be populated by image extraction)
        let rootfs_path = bundle_path.join("rootfs");
        std::fs::create_dir_all(&rootfs_path)?;

        // Generate OCI config
        use crate::engine::OciConfigBuilder;

        let mut builder = OciConfigBuilder::from_validated(config)
            .rootfs("rootfs")
            .hostname(name);

        if let Some(cmd) = command {
            builder = builder.command(cmd);
        }

        let config_path = bundle_path.join("config.json");
        builder.write_to_file(&config_path)?;

        // Serialize config for storage
        let config_json = serde_json::json!({
            "privileged": config.privileged,
            "user_namespace": config.user_namespace,
            "user_id": config.user_id,
            "no_new_privileges": config.no_new_privileges,
            "readonly_rootfs": config.readonly_rootfs,
        });

        // Create database record
        self.state.create_container(
            id,
            name,
            image_id,
            bundle_path.to_str().unwrap(),
            Some(&config_json.to_string()),
        )?;

        self.state.get_container(id).map_err(|e| e.into())
    }

    /// Start a container
    pub async fn start(&self, id: &str) -> Result<u32, LifecycleError> {
        let container = self.state.get_container(id)?;

        // Validate state transition
        if container.state != ContainerState::Created {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Running,
            });
        }

        info!("Starting container {} ({})", container.name, container.id);

        // Start via runtime shim
        let shim = ShimClient::new(&self.runtime_path, &container.bundle_path);
        let pid = shim
            .create_and_start(id)
            .await
            .map_err(|e| LifecycleError::Runtime(e.to_string()))?;

        // Update state
        self.state
            .set_container_state(id, ContainerState::Running, Some(pid as i32))?;

        Ok(pid)
    }

    /// Stop a container
    pub async fn stop(&self, id: &str, timeout_secs: u32) -> Result<(), LifecycleError> {
        let container = self.state.get_container(id)?;

        if container.state != ContainerState::Running {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Stopped,
            });
        }

        info!(
            "Stopping container {} (timeout: {}s)",
            container.name, timeout_secs
        );

        // Send SIGTERM, wait, then SIGKILL if necessary
        if let Some(pid) = container.pid {
            // Send SIGTERM
            #[cfg(unix)]
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }

            // Wait for graceful shutdown
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs as u64);

            while std::time::Instant::now() < deadline {
                if !process_exists(pid) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }

            // Force kill if still running
            if process_exists(pid) {
                warn!("Container {} did not stop gracefully, sending SIGKILL", id);
                #[cfg(unix)]
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }

        // Update state
        self.state
            .set_container_state(id, ContainerState::Stopped, None)?;

        Ok(())
    }

    /// Kill a container with a signal
    pub fn kill(&self, id: &str, signal: i32) -> Result<(), LifecycleError> {
        let container = self.state.get_container(id)?;

        if container.state != ContainerState::Running {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Stopped,
            });
        }

        if let Some(pid) = container.pid {
            #[cfg(unix)]
            unsafe {
                libc::kill(pid, signal);
            }
        }

        Ok(())
    }

    /// Delete a container
    pub fn delete(&self, id: &str, force: bool) -> Result<(), LifecycleError> {
        let container = self.state.get_container(id)?;

        // Check if container can be deleted
        if container.state == ContainerState::Running && !force {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Stopped,
            });
        }

        info!("Deleting container {} ({})", container.name, container.id);

        // Kill if still running and force is set
        if container.state == ContainerState::Running {
            if let Some(pid) = container.pid {
                #[cfg(unix)]
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }

        // Remove bundle directory
        let bundle_path = Path::new(&container.bundle_path);
        if bundle_path.exists() {
            std::fs::remove_dir_all(bundle_path)?;
        }

        // Remove from database
        self.state.delete_container(id)?;

        Ok(())
    }

    /// Pause a container
    pub fn pause(&self, id: &str) -> Result<(), LifecycleError> {
        let container = self.state.get_container(id)?;

        if container.state != ContainerState::Running {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Paused,
            });
        }

        // Use cgroups to freeze the container
        if let Some(pid) = container.pid {
            debug!("Pausing container {} (pid: {})", id, pid);
            // TODO: Implement cgroup freezer
        }

        self.state
            .set_container_state(id, ContainerState::Paused, container.pid)?;

        Ok(())
    }

    /// Resume a paused container
    pub fn resume(&self, id: &str) -> Result<(), LifecycleError> {
        let container = self.state.get_container(id)?;

        if container.state != ContainerState::Paused {
            return Err(LifecycleError::InvalidTransition {
                from: container.state,
                to: ContainerState::Running,
            });
        }

        // Use cgroups to thaw the container
        if let Some(pid) = container.pid {
            debug!("Resuming container {} (pid: {})", id, pid);
            // TODO: Implement cgroup freezer
        }

        self.state
            .set_container_state(id, ContainerState::Running, container.pid)?;

        Ok(())
    }

    /// Get container state
    pub fn get(&self, id: &str) -> Result<ContainerInfo, LifecycleError> {
        self.state.get_container(id).map_err(|e| e.into())
    }

    /// List containers
    pub fn list(
        &self,
        state_filter: Option<ContainerState>,
    ) -> Result<Vec<ContainerInfo>, LifecycleError> {
        self.state.list_containers(state_filter).map_err(|e| e.into())
    }
}

/// Check if a process exists
fn process_exists(pid: i32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_lifecycle_creation() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let root_dir = temp_dir.path().join("root");

        let lifecycle = ContainerLifecycle::new(&db_path, &root_dir, "youki").unwrap();

        // Create a test config
        let config = crate::ffi::ValidatedConfig {
            privileged: false,
            user_namespace: true,
            user_id: 1000,
            network_mode: crate::ffi::NetworkMode::Unprivileged,
            capabilities: vec![],
            no_new_privileges: true,
            readonly_rootfs: false,
        };

        // Create container
        let container = lifecycle
            .create("test-123", "test-container", "image-abc", &config, None)
            .unwrap();

        assert_eq!(container.name, "test-container");
        assert_eq!(container.state, ContainerState::Created);
    }
}
