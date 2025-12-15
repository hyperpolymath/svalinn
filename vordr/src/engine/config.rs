//! SPDX-License-Identifier: MIT OR AGPL-3.0-or-later
//! OCI runtime configuration generation

use oci_spec::runtime::{
    LinuxBuilder, LinuxCapabilitiesBuilder, LinuxNamespace, LinuxNamespaceBuilder,
    LinuxNamespaceType, MountBuilder, ProcessBuilder, RootBuilder, Spec, SpecBuilder, UserBuilder,
};
use std::path::Path;
use thiserror::Error;

use crate::ffi::{NetworkMode, ValidatedConfig};

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("OCI spec error: {0}")]
    OciSpec(String),
    #[error("Invalid configuration: {0}")]
    Invalid(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Builder for creating OCI runtime specifications
#[derive(Debug, Clone)]
pub struct OciConfigBuilder {
    /// Container root directory
    rootfs_path: String,
    /// Command to run
    command: Vec<String>,
    /// Environment variables
    env: Vec<String>,
    /// Working directory
    cwd: String,
    /// User ID
    uid: u32,
    /// Group ID
    gid: u32,
    /// Terminal allocation
    terminal: bool,
    /// Hostname
    hostname: Option<String>,
    /// Read-only rootfs
    readonly_rootfs: bool,
    /// Capabilities to add
    cap_add: Vec<String>,
    /// Capabilities to drop
    cap_drop: Vec<String>,
    /// Additional mounts
    mounts: Vec<MountSpec>,
    /// Namespaces to create
    namespaces: Vec<LinuxNamespaceType>,
    /// Privileged mode
    privileged: bool,
    /// No new privileges
    no_new_privileges: bool,
}

/// Mount specification
#[derive(Debug, Clone)]
pub struct MountSpec {
    pub source: String,
    pub destination: String,
    pub mount_type: String,
    pub options: Vec<String>,
}

impl Default for OciConfigBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl OciConfigBuilder {
    /// Create a new OCI config builder with secure defaults
    pub fn new() -> Self {
        Self {
            rootfs_path: "rootfs".to_string(),
            command: vec!["/bin/sh".to_string()],
            env: vec![
                "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
                "TERM=xterm".to_string(),
            ],
            cwd: "/".to_string(),
            uid: 0,
            gid: 0,
            terminal: true,
            hostname: None,
            readonly_rootfs: false,
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
            mounts: Vec::new(),
            namespaces: vec![
                LinuxNamespaceType::Pid,
                LinuxNamespaceType::Network,
                LinuxNamespaceType::Ipc,
                LinuxNamespaceType::Uts,
                LinuxNamespaceType::Mount,
            ],
            privileged: false,
            no_new_privileges: true,
        }
    }

    /// Create from a validated configuration
    pub fn from_validated(config: &ValidatedConfig) -> Self {
        let mut builder = Self::new();
        builder.uid = config.user_id;
        builder.privileged = config.privileged;
        builder.no_new_privileges = config.no_new_privileges;
        builder.readonly_rootfs = config.readonly_rootfs;

        if config.user_namespace {
            builder.namespaces.push(LinuxNamespaceType::User);
        }

        for cap in &config.capabilities {
            builder.cap_add.push(cap.clone());
        }

        builder
    }

    /// Set the rootfs path
    pub fn rootfs(mut self, path: impl Into<String>) -> Self {
        self.rootfs_path = path.into();
        self
    }

    /// Set the command to run
    pub fn command(mut self, cmd: Vec<String>) -> Self {
        if !cmd.is_empty() {
            self.command = cmd;
        }
        self
    }

    /// Add environment variables
    pub fn env(mut self, env: Vec<String>) -> Self {
        self.env.extend(env);
        self
    }

    /// Set working directory
    pub fn cwd(mut self, cwd: impl Into<String>) -> Self {
        self.cwd = cwd.into();
        self
    }

    /// Set user ID
    pub fn uid(mut self, uid: u32) -> Self {
        self.uid = uid;
        self
    }

    /// Set group ID
    pub fn gid(mut self, gid: u32) -> Self {
        self.gid = gid;
        self
    }

    /// Set terminal allocation
    pub fn terminal(mut self, terminal: bool) -> Self {
        self.terminal = terminal;
        self
    }

    /// Set hostname
    pub fn hostname(mut self, hostname: impl Into<String>) -> Self {
        self.hostname = Some(hostname.into());
        self
    }

    /// Set read-only rootfs
    pub fn readonly_rootfs(mut self, readonly: bool) -> Self {
        self.readonly_rootfs = readonly;
        self
    }

    /// Add a capability
    pub fn add_capability(mut self, cap: impl Into<String>) -> Self {
        self.cap_add.push(cap.into());
        self
    }

    /// Drop a capability
    pub fn drop_capability(mut self, cap: impl Into<String>) -> Self {
        self.cap_drop.push(cap.into());
        self
    }

    /// Add a mount
    pub fn mount(mut self, mount: MountSpec) -> Self {
        self.mounts.push(mount);
        self
    }

    /// Set privileged mode
    pub fn privileged(mut self, privileged: bool) -> Self {
        self.privileged = privileged;
        self
    }

    /// Enable user namespace
    pub fn user_namespace(mut self, enabled: bool) -> Self {
        if enabled && !self.namespaces.contains(&LinuxNamespaceType::User) {
            self.namespaces.push(LinuxNamespaceType::User);
        } else if !enabled {
            self.namespaces.retain(|ns| *ns != LinuxNamespaceType::User);
        }
        self
    }

    /// Build the OCI runtime specification
    pub fn build(self) -> Result<Spec, ConfigError> {
        // Build user
        let user = UserBuilder::default()
            .uid(self.uid)
            .gid(self.gid)
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;

        // Build capabilities
        let default_caps = self.get_default_capabilities();
        let capabilities = LinuxCapabilitiesBuilder::default()
            .bounding(default_caps.clone())
            .effective(default_caps.clone())
            .inheritable(default_caps.clone())
            .permitted(default_caps.clone())
            .ambient(default_caps)
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;

        // Build process
        let mut process_builder = ProcessBuilder::default();
        process_builder
            .terminal(self.terminal)
            .user(user)
            .args(self.command)
            .env(self.env)
            .cwd(self.cwd.clone())
            .capabilities(capabilities)
            .no_new_privileges(self.no_new_privileges);

        let process = process_builder
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;

        // Build root
        let root = RootBuilder::default()
            .path(self.rootfs_path)
            .readonly(self.readonly_rootfs)
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;

        // Build mounts
        let mut mounts = self.get_default_mounts();
        for mount in self.mounts {
            let m = MountBuilder::default()
                .source(mount.source)
                .destination(mount.destination)
                .typ(mount.mount_type)
                .options(mount.options)
                .build()
                .map_err(|e| ConfigError::OciSpec(e.to_string()))?;
            mounts.push(m);
        }

        // Build namespaces
        let namespaces: Vec<LinuxNamespace> = self
            .namespaces
            .iter()
            .map(|ns| {
                LinuxNamespaceBuilder::default()
                    .typ(*ns)
                    .build()
                    .unwrap()
            })
            .collect();

        // Build linux config
        let linux = LinuxBuilder::default()
            .namespaces(namespaces)
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;

        // Build final spec
        let mut spec_builder = SpecBuilder::default();
        spec_builder
            .version("1.0.2")
            .root(root)
            .process(process)
            .mounts(mounts)
            .linux(linux);

        if let Some(hostname) = self.hostname {
            spec_builder.hostname(hostname);
        }

        spec_builder
            .build()
            .map_err(|e| ConfigError::OciSpec(e.to_string()))
    }

    /// Write the configuration to a file
    pub fn write_to_file(self, path: &Path) -> Result<(), ConfigError> {
        let spec = self.build()?;
        let json = serde_json::to_string_pretty(&spec)
            .map_err(|e| ConfigError::OciSpec(e.to_string()))?;
        std::fs::write(path, json)?;
        Ok(())
    }

    fn get_default_capabilities(&self) -> Vec<String> {
        if self.privileged {
            // All capabilities in privileged mode
            return vec![
                "CAP_AUDIT_CONTROL",
                "CAP_AUDIT_READ",
                "CAP_AUDIT_WRITE",
                "CAP_BLOCK_SUSPEND",
                "CAP_CHOWN",
                "CAP_DAC_OVERRIDE",
                "CAP_DAC_READ_SEARCH",
                "CAP_FOWNER",
                "CAP_FSETID",
                "CAP_IPC_LOCK",
                "CAP_IPC_OWNER",
                "CAP_KILL",
                "CAP_LEASE",
                "CAP_LINUX_IMMUTABLE",
                "CAP_MAC_ADMIN",
                "CAP_MAC_OVERRIDE",
                "CAP_MKNOD",
                "CAP_NET_ADMIN",
                "CAP_NET_BIND_SERVICE",
                "CAP_NET_BROADCAST",
                "CAP_NET_RAW",
                "CAP_SETFCAP",
                "CAP_SETGID",
                "CAP_SETPCAP",
                "CAP_SETUID",
                "CAP_SYSLOG",
                "CAP_SYS_ADMIN",
                "CAP_SYS_BOOT",
                "CAP_SYS_CHROOT",
                "CAP_SYS_MODULE",
                "CAP_SYS_NICE",
                "CAP_SYS_PACCT",
                "CAP_SYS_PTRACE",
                "CAP_SYS_RAWIO",
                "CAP_SYS_RESOURCE",
                "CAP_SYS_TIME",
                "CAP_SYS_TTY_CONFIG",
                "CAP_WAKE_ALARM",
            ]
            .into_iter()
            .map(String::from)
            .collect();
        }

        // Default unprivileged capabilities (OCI defaults)
        let mut caps: Vec<String> = vec![
            "CAP_CHOWN",
            "CAP_DAC_OVERRIDE",
            "CAP_FSETID",
            "CAP_FOWNER",
            "CAP_MKNOD",
            "CAP_NET_RAW",
            "CAP_SETGID",
            "CAP_SETUID",
            "CAP_SETFCAP",
            "CAP_SETPCAP",
            "CAP_NET_BIND_SERVICE",
            "CAP_SYS_CHROOT",
            "CAP_KILL",
            "CAP_AUDIT_WRITE",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        // Add requested capabilities
        for cap in &self.cap_add {
            let cap_name = if cap.starts_with("CAP_") {
                cap.clone()
            } else {
                format!("CAP_{}", cap.to_uppercase())
            };
            if !caps.contains(&cap_name) {
                caps.push(cap_name);
            }
        }

        // Remove dropped capabilities
        for cap in &self.cap_drop {
            let cap_name = if cap.starts_with("CAP_") {
                cap.clone()
            } else {
                format!("CAP_{}", cap.to_uppercase())
            };
            caps.retain(|c| c != &cap_name);
        }

        caps
    }

    fn get_default_mounts(&self) -> Vec<oci_spec::runtime::Mount> {
        use oci_spec::runtime::Mount;

        vec![
            MountBuilder::default()
                .destination("/proc")
                .typ("proc")
                .source("proc")
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination("/dev")
                .typ("tmpfs")
                .source("tmpfs")
                .options(vec![
                    "nosuid".to_string(),
                    "strictatime".to_string(),
                    "mode=755".to_string(),
                    "size=65536k".to_string(),
                ])
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination("/dev/pts")
                .typ("devpts")
                .source("devpts")
                .options(vec![
                    "nosuid".to_string(),
                    "noexec".to_string(),
                    "newinstance".to_string(),
                    "ptmxmode=0666".to_string(),
                    "mode=0620".to_string(),
                ])
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination("/dev/shm")
                .typ("tmpfs")
                .source("shm")
                .options(vec![
                    "nosuid".to_string(),
                    "noexec".to_string(),
                    "nodev".to_string(),
                    "mode=1777".to_string(),
                    "size=65536k".to_string(),
                ])
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination("/dev/mqueue")
                .typ("mqueue")
                .source("mqueue")
                .options(vec![
                    "nosuid".to_string(),
                    "noexec".to_string(),
                    "nodev".to_string(),
                ])
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination("/sys")
                .typ("sysfs")
                .source("sysfs")
                .options(vec![
                    "nosuid".to_string(),
                    "noexec".to_string(),
                    "nodev".to_string(),
                    "ro".to_string(),
                ])
                .build()
                .unwrap(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let spec = OciConfigBuilder::new().build().unwrap();
        assert_eq!(spec.version(), "1.0.2");
    }

    #[test]
    fn test_custom_command() {
        let spec = OciConfigBuilder::new()
            .command(vec!["echo".to_string(), "hello".to_string()])
            .build()
            .unwrap();

        let process = spec.process().as_ref().unwrap();
        assert_eq!(process.args().as_ref().unwrap()[0], "echo");
    }

    #[test]
    fn test_readonly_rootfs() {
        let spec = OciConfigBuilder::new().readonly_rootfs(true).build().unwrap();

        let root = spec.root().as_ref().unwrap();
        assert!(root.readonly().unwrap_or(false));
    }
}
