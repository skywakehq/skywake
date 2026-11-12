//! A pass: what the API lets one caller do with one namespace's branch heads on the cache tier.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::hmac;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Pass {
    pub folder: String,
    pub access: String,
    #[serde(default)]
    pub protected: Vec<String>,
    pub expires: u64,
}

impl Pass {
    pub fn sign(&self, token: &str) -> String {
        let body = serde_json::to_vec(self).expect("a pass is plain data");
        let tag = hmac::sign(&key(token), &body);
        format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(&body),
            URL_SAFE_NO_PAD.encode(tag.as_ref())
        )
    }

    pub fn check(text: &str, token: &str) -> Option<Self> {
        let (body, tag) = text.split_once('.')?;
        let body = URL_SAFE_NO_PAD.decode(body).ok()?;
        let tag = URL_SAFE_NO_PAD.decode(tag).ok()?;
        hmac::verify(&key(token), &body, &tag).ok()?;
        let pass: Self = serde_json::from_slice(&body).ok()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
        (now < pass.expires).then_some(pass)
    }

    pub fn writes(&self) -> bool {
        self.access == "write"
    }
}

fn key(token: &str) -> hmac::Key {
    hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass(expires: u64) -> Pass {
        Pass {
            folder: "org/ns".into(),
            access: "write".into(),
            protected: vec!["main".into()],
            expires,
        }
    }

    #[test]
    fn a_pass_the_api_made_is_accepted() {
        let text = "eyJmb2xkZXIiOiJvcmcvbnMiLCJhY2Nlc3MiOiJ3cml0ZSIsInByb3RlY3RlZCI6WyJtYWluIl0sImV4cGlyZXMiOjQxMDI0NDQ4MDB9.STceLSsY8ediXzbpSfsANMevl7kUFa8z6Zzfb0EbfSI";
        assert_eq!(Pass::check(text, "test-token"), Some(pass(4102444800)));
    }

    #[test]
    fn only_the_token_that_signed_a_live_pass_accepts_it() {
        let later = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 60;
        let text = pass(later).sign("token");
        assert_eq!(Pass::check(&text, "token"), Some(pass(later)));
        assert_eq!(Pass::check(&text, "other"), None);
        assert_eq!(Pass::check(&pass(1).sign("token"), "token"), None);
        let (_, tag) = text.split_once('.').unwrap();
        let forged = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&Pass {
                folder: "org/other".into(),
                ..pass(later)
            })
            .unwrap(),
        );
        assert_eq!(Pass::check(&format!("{forged}.{tag}"), "token"), None);
    }
}
