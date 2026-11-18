use std::path::PathBuf;
use std::process::Stdio;

use serde::Serialize;
use tokio::process::Command;

use super::settings::Target;

#[derive(Clone, Debug, Default, Serialize)]
pub(crate) struct Found {
    pub docker: bool,
    pub kube_context: Option<String>,
    pub aws: bool,
    pub gcp: bool,
    pub azure: bool,
}

impl Found {
    pub(crate) async fn look() -> Self {
        let (docker, kube_context) = tokio::join!(docker_running(), kube_context());
        Self {
            docker,
            kube_context,
            aws: env("AWS_ACCESS_KEY_ID")
                || env("AWS_PROFILE")
                || home(".aws/credentials")
                || home(".aws/config"),
            gcp: env("GOOGLE_APPLICATION_CREDENTIALS")
                || env("CLOUDSDK_CONFIG")
                || home(".config/gcloud/application_default_credentials.json"),
            azure: env("AZURE_CLIENT_ID") || home(".azure/azureProfile.json"),
        }
    }

    pub(crate) fn ready(&self, target: Target) -> bool {
        match target {
            Target::Local => self.docker,
            Target::Docker => false,
            Target::Kubernetes => self.kube_context.is_some(),
            Target::Aws => self.aws,
            Target::Gcp => self.gcp,
            Target::Azure => self.azure,
        }
    }

    pub(crate) fn why(&self, target: Target) -> String {
        match (target, self.ready(target)) {
            (Target::Local, true) => "Docker is running".into(),
            (Target::Local, false) => "needs Docker running".into(),
            (Target::Docker, _) => "needs SSH to a server with Docker".into(),
            (Target::Kubernetes, true) => {
                format!(
                    "context {}",
                    self.kube_context.as_deref().unwrap_or_default()
                )
            }
            (Target::Kubernetes, false) => "no kube context".into(),
            (_, true) => "credentials found".into(),
            (_, false) => "no credentials found".into(),
        }
    }

    pub(crate) fn best(&self) -> Target {
        match self.docker {
            true => Target::Local,
            false => (Target::ALL.into_iter())
                .find(|&target| self.ready(target))
                .unwrap_or(Target::Local),
        }
    }
}

fn env(name: &str) -> bool {
    std::env::var_os(name).is_some_and(|value| !value.is_empty())
}

fn home(path: &str) -> bool {
    std::env::var_os("HOME").is_some_and(|home| PathBuf::from(home).join(path).exists())
}

pub(crate) async fn quiet(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) async fn docker_running() -> bool {
    quiet("docker", &["info", "--format", "{{.ServerVersion}}"])
        .await
        .is_some_and(|version| !version.is_empty())
}

async fn kube_context() -> Option<String> {
    quiet("kubectl", &["config", "current-context"])
        .await
        .filter(|context| !context.is_empty())
}
