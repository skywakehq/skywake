//! The few calls the window needs from skywake-api, made with the account's
//! current token.

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::auth::{Account, encode};

#[derive(Serialize, Deserialize)]
pub struct Environment {
    pub name: String,
}

/// A disk: a namespace such as `prod/website`, whose first part is its environment.
#[derive(Serialize, Deserialize)]
pub struct Disk {
    pub name: String,
    pub region: String,
}

#[derive(Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    pub forked_from: Option<String>,
    pub protected: bool,
}

#[derive(Serialize, Deserialize)]
pub struct Commit {
    pub message: String,
    /// Seconds since 1970.
    pub time: u64,
}

async fn get<T: DeserializeOwned>(account: &Account, path: &str) -> Result<T, String> {
    // One retry after a 401: the token may have been turned over meanwhile.
    for first in [true, false] {
        let token = account.token().await?;
        let response = reqwest::Client::new()
            .get(format!("{}/v1{path}", account.api))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| format!("Could not reach Skywake at {}.", account.api))?;
        match response.status().as_u16() {
            401 if first => account.expire().await,
            401 => return Err("signed-out".into()),
            404 => return Err("not-found".into()),
            _ => {
                let response = response
                    .error_for_status()
                    .map_err(|error| error.to_string())?;
                return response.json().await.map_err(|error| error.to_string());
            }
        }
    }
    Err("signed-out".into())
}

pub async fn environments(account: &Account) -> Result<Vec<Environment>, String> {
    get(account, "/environments").await
}

pub async fn disks(account: &Account) -> Result<Vec<Disk>, String> {
    get(account, "/namespaces").await
}

pub async fn branches(account: &Account, disk: &str) -> Result<Vec<Branch>, String> {
    get(
        account,
        &format!("/namespaces/{}/branches?limit=200", encode(disk)),
    )
    .await
}

/// The latest commits on a branch, newest first. None for a disk with no commits yet.
pub async fn commits(account: &Account, disk: &str, branch: &str) -> Result<Vec<Commit>, String> {
    let path = format!(
        "/namespaces/{}/branches/{}/commits?limit=8",
        encode(disk),
        encode(branch)
    );
    match get(account, &path).await {
        Err(error) if error == "not-found" => Ok(Vec::new()),
        other => other,
    }
}
