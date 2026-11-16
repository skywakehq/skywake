use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Read,
    Write,
    Admin,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Whoami {
    pub organization: String,
    pub environment: Option<String>,
    pub role: Role,
    #[serde(default)]
    pub only: Vec<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub expires: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Key {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub environment: Option<String>,
    #[serde(default)]
    pub only: Vec<String>,
    #[serde(default)]
    pub expires: Option<String>,
    #[serde(default)]
    pub last_used: Option<String>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_by_email: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreatedKey {
    pub id: String,
    pub key: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Environment {
    pub name: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub store: Value,
}
