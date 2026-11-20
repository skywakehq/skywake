//! Signing in through the browser: OAuth 2.0's authorization code flow with
//! PKCE (RFC 7636), redirected to a port on this Mac's loopback address
//! (RFC 8252). The app never sees a password, and a code caught on its way
//! back is useless without the verifier that never leaves the app.
//!
//! The access token is an API key that lives an hour; the refresh token makes
//! the next pair. Both live only in the Keychain (`keychain.rs`).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use axum::Router;
use axum::extract::{Query, State};
use axum::response::Html;
use axum::routing::get;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, oneshot};

use crate::keychain;

pub const CLIENT: &str = "skywake-desktop";

/// Refresh this long before the access token runs out, so no call races it.
const EARLY: u64 = 60;
const SIGN_IN_WAIT: Duration = Duration::from_secs(600);

fn random(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    SystemRandom::new()
        .fill(&mut buffer)
        .map_err(|_| "this Mac gave no random bytes".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// A PKCE pair: the verifier stays here, the challenge goes to the browser.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn new() -> Result<Self, String> {
        // 32 bytes make 43 characters, the shortest verifier RFC 7636 allows.
        let verifier = random(32)?;
        let challenge = challenge_of(&verifier);
        Ok(Pkce {
            verifier,
            challenge,
        })
    }
}

/// S256: BASE64URL(SHA-256(verifier)), without padding.
pub fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        verifier.as_bytes(),
    ))
}

/// A word only this sign-in knows, so no other page can answer it.
pub fn new_state() -> Result<String, String> {
    random(32)
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |diff, (x, y)| diff | (x ^ y))
            == 0
}

pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}/callback")
}

/// The console page that asks the person to allow the app.
pub fn authorize_url(
    console: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
    device: &str,
    org: Option<&str>,
) -> String {
    let mut query = vec![
        ("response_type", "code"),
        ("client_id", CLIENT),
        ("redirect_uri", redirect),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("device", device),
    ];
    if let Some(org) = org {
        query.push(("org", org));
    }
    let query: Vec<String> = query
        .into_iter()
        .map(|(name, value)| format!("{name}={}", encode(value)))
        .collect();
    format!("{console}/desktop?{}", query.join("&"))
}

#[derive(Debug, PartialEq)]
pub enum Answer {
    Code(String),
    Denied,
    /// Not from the sign-in this app started: a wrong or missing `state`.
    Forged,
}

/// What the browser brought back to the loopback address.
pub fn read_answer(query: &HashMap<String, String>, state: &str) -> Answer {
    if !query.get("state").is_some_and(|got| same(got, state)) {
        return Answer::Forged;
    }
    match (query.get("code"), query.get("error")) {
        (Some(code), None) if !code.is_empty() => Answer::Code(code.clone()),
        _ => Answer::Denied,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Org {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    expires_in: u64,
    refresh_token: String,
    organization: Org,
    organizations: Vec<Org>,
    environment: Option<String>,
    role: String,
    email: Option<String>,
}

/// Everything kept for a signed-in app: in the Keychain, never on disk.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// When the access token stops working, in seconds since 1970.
    pub expires_at: u64,
    pub organization: Org,
    pub organizations: Vec<Org>,
    pub environment: Option<String>,
    pub role: String,
    pub email: Option<String>,
}

impl Session {
    fn from(tokens: Tokens, now: u64) -> Self {
        Session {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: now + tokens.expires_in,
            organization: tokens.organization,
            organizations: tokens.organizations,
            environment: tokens.environment,
            role: tokens.role,
            email: tokens.email,
        }
    }

    pub fn fresh(&self, now: u64) -> bool {
        now + EARLY < self.expires_at
    }
}

/// Who the app is signed in as, for the window: no tokens in it.
#[derive(Clone, Debug, Serialize)]
pub struct Profile {
    pub organization: Org,
    pub organizations: Vec<Org>,
    pub environment: Option<String>,
    pub role: String,
    pub email: Option<String>,
}

impl From<&Session> for Profile {
    fn from(session: &Session) -> Self {
        Profile {
            organization: session.organization.clone(),
            organizations: session.organizations.clone(),
            environment: session.environment.clone(),
            role: session.role.clone(),
            email: session.email.clone(),
        }
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

#[derive(Debug, PartialEq)]
pub enum AuthError {
    SignedOut,
    Offline(String),
}

impl From<AuthError> for String {
    fn from(error: AuthError) -> String {
        match error {
            AuthError::SignedOut => "signed-out".into(),
            AuthError::Offline(why) => why,
        }
    }
}

/// The signed-in account. One refresh at a time: a refresh token works once,
/// and a second use would end the sign-in.
pub struct Account {
    pub api: String,
    pub console: String,
    http: reqwest::Client,
    session: Mutex<Option<Option<Session>>>,
}

impl Account {
    pub fn new(api: String, console: String) -> Self {
        Account {
            api,
            console,
            http: reqwest::Client::new(),
            session: Mutex::new(None),
        }
    }

    async fn loaded(&self) -> tokio::sync::MutexGuard<'_, Option<Option<Session>>> {
        let mut session = self.session.lock().await;
        if session.is_none() {
            *session = Some(keychain::load());
        }
        session
    }

    pub async fn profile(&self) -> Option<Profile> {
        self.loaded().await.as_ref()?.as_ref().map(Profile::from)
    }

    /// A working access token, refreshed first when it is about to run out.
    pub async fn token(&self) -> Result<String, AuthError> {
        let mut guard = self.loaded().await;
        let Some(Some(session)) = guard.as_ref() else {
            return Err(AuthError::SignedOut);
        };
        if session.fresh(now()) {
            return Ok(session.access_token.clone());
        }
        let refresh = session.refresh_token.clone();
        match self.exchange(json_refresh(&refresh)).await {
            Ok(next) => {
                let token = next.access_token.clone();
                keychain::save(&next).map_err(AuthError::Offline)?;
                *guard = Some(Some(next));
                Ok(token)
            }
            Err(AuthError::SignedOut) => {
                keychain::delete();
                *guard = Some(None);
                Err(AuthError::SignedOut)
            }
            Err(error) => Err(error),
        }
    }

    /// An account that uses one key, for tests against a running API.
    #[cfg(test)]
    pub fn with_token(api: &str, key: &str) -> Self {
        let account = Account::new(api.into(), api.into());
        let org = Org {
            id: String::new(),
            name: String::new(),
        };
        *account.session.try_lock().unwrap() = Some(Some(Session {
            access_token: key.into(),
            refresh_token: String::new(),
            expires_at: u64::MAX / 2,
            organization: org,
            organizations: vec![],
            environment: None,
            role: "write".into(),
            email: None,
        }));
        account
    }

    /// After a 401: the token was refused early, perhaps by a clock that is off.
    pub async fn expire(&self) {
        if let Some(Some(session)) = self.loaded().await.as_mut() {
            session.expires_at = 0;
        }
    }

    async fn exchange(&self, body: serde_json::Value) -> Result<Session, AuthError> {
        let response = self
            .http
            .post(format!("{}/v1/oauth/token", self.api))
            .json(&body)
            .send()
            .await
            .map_err(|_| AuthError::Offline(format!("Could not reach Skywake at {}.", self.api)))?;
        match response.status().as_u16() {
            200 => {}
            400 | 401 => return Err(AuthError::SignedOut),
            status => {
                return Err(AuthError::Offline(format!(
                    "Skywake answered {status}. Try again in a moment."
                )));
            }
        }
        let tokens: Tokens = response
            .json()
            .await
            .map_err(|error| AuthError::Offline(error.to_string()))?;
        Ok(Session::from(tokens, now()))
    }

    /// Opens the browser to allow the app, and waits for the code to come back.
    pub async fn sign_in(
        &self,
        open: impl FnOnce(&str) -> Result<(), String>,
        device: &str,
        org: Option<&str>,
    ) -> Result<Profile, String> {
        let pkce = Pkce::new()?;
        let state = new_state()?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|error| error.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let redirect = redirect_uri(port);

        let (send, got) = oneshot::channel();
        let waiting = Arc::new(Waiting {
            state: state.clone(),
            send: std::sync::Mutex::new(Some(send)),
        });
        let router = Router::new()
            .route("/callback", get(callback))
            .with_state(waiting);
        let server = tokio::spawn(async move { axum::serve(listener, router).await });

        let url = authorize_url(
            &self.console,
            &redirect,
            &state,
            &pkce.challenge,
            device,
            org,
        );
        let answer = match open(&url) {
            Ok(()) => tokio::time::timeout(SIGN_IN_WAIT, got).await,
            Err(error) => {
                server.abort();
                return Err(error);
            }
        };
        server.abort();
        let code = match answer {
            Err(_) => return Err("Sign-in took too long. Try again.".into()),
            Ok(Err(_)) => return Err("Sign-in stopped.".into()),
            Ok(Ok(code)) => code?,
        };

        let session = self
            .exchange(serde_json::json!({
                "grant_type": "authorization_code",
                "client_id": CLIENT,
                "code": code,
                "code_verifier": pkce.verifier,
                "redirect_uri": redirect,
            }))
            .await
            .map_err(|error| match error {
                AuthError::SignedOut => "The sign-in was refused. Try again.".to_string(),
                AuthError::Offline(why) => why,
            })?;
        keychain::save(&session)?;
        let profile = Profile::from(&session);
        *self.session.lock().await = Some(Some(session));
        Ok(profile)
    }

    /// Ends the sign-in on the server too, then forgets it here.
    pub async fn sign_out(&self) {
        let session = self.loaded().await.take().flatten();
        *self.session.lock().await = Some(None);
        keychain::delete();
        if let Some(session) = session {
            let _ = self
                .http
                .post(format!("{}/v1/oauth/revoke", self.api))
                .json(&serde_json::json!({ "client_id": CLIENT, "token": session.refresh_token }))
                .timeout(Duration::from_secs(10))
                .send()
                .await;
        }
    }
}

fn json_refresh(token: &str) -> serde_json::Value {
    serde_json::json!({
        "grant_type": "refresh_token",
        "client_id": CLIENT,
        "refresh_token": token,
    })
}

struct Waiting {
    state: String,
    send: std::sync::Mutex<Option<oneshot::Sender<Result<String, String>>>>,
}

async fn callback(
    State(waiting): State<Arc<Waiting>>,
    Query(query): Query<HashMap<String, String>>,
) -> Html<String> {
    let (result, message) = match read_answer(&query, &waiting.state) {
        // Someone else's page: ignore it and keep waiting for the real answer.
        Answer::Forged => {
            return page(
                "This sign-in link is not from Skywake on this Mac. Start again from the app.",
            );
        }
        Answer::Denied => (
            Err("You cancelled the sign-in.".to_string()),
            "Sign-in cancelled. You can close this tab.",
        ),
        Answer::Code(code) => (
            Ok(code),
            "You're signed in. You can close this tab and go back to Skywake.",
        ),
    };
    if let Some(send) = waiting.send.lock().unwrap().take() {
        let _ = send.send(result);
    }
    page(message)
}

fn page(message: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><meta charset=utf-8><title>Skywake</title>\
         <style>body{{margin:0;min-height:100vh;display:grid;place-items:center;\
         font:15px -apple-system,system-ui,sans-serif;background:#f6f5f1;color:#161614}}\
         p{{max-width:28em;text-align:center}}\
         @media(prefers-color-scheme:dark){{body{{background:#161615;color:#ecebe5}}}}</style>\
         <p>{message}</p>"
    ))
}

/// Percent-encodes a value for a URL.
pub fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_rfc_7636s_example() {
        // RFC 7636, appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_of(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_are_new_each_time_and_well_formed() {
        let one = Pkce::new().unwrap();
        let two = Pkce::new().unwrap();
        assert_ne!(one.verifier, two.verifier);
        for pkce in [&one, &two] {
            assert_eq!(pkce.verifier.len(), 43);
            assert!(
                pkce.verifier
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            );
            assert_eq!(pkce.challenge, challenge_of(&pkce.verifier));
            assert_eq!(pkce.challenge.len(), 43);
        }
        assert_ne!(new_state().unwrap(), new_state().unwrap());
    }

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn only_the_answer_with_our_state_counts() {
        let state = "a-state-only-we-know-0123456789abcdef";
        assert_eq!(
            read_answer(&query(&[("code", "swc_1"), ("state", state)]), state),
            Answer::Code("swc_1".into())
        );
        assert_eq!(
            read_answer(&query(&[("code", "swc_1"), ("state", "other")]), state),
            Answer::Forged
        );
        assert_eq!(
            read_answer(&query(&[("code", "swc_1")]), state),
            Answer::Forged
        );
        assert_eq!(
            read_answer(
                &query(&[("error", "access_denied"), ("state", state)]),
                state
            ),
            Answer::Denied
        );
        assert_eq!(
            read_answer(&query(&[("code", ""), ("state", state)]), state),
            Answer::Denied
        );
    }

    #[test]
    fn the_authorize_url_carries_the_pkce_challenge_and_state() {
        let url = authorize_url(
            "https://console.example",
            &redirect_uri(53682),
            "st",
            "ch",
            "Studio Mac",
            Some("org_1"),
        );
        assert_eq!(
            url,
            "https://console.example/desktop?response_type=code&client_id=skywake-desktop\
             &redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback&code_challenge=ch\
             &code_challenge_method=S256&state=st&device=Studio%20Mac&org=org_1"
        );
    }

    #[test]
    fn a_token_is_refreshed_a_minute_before_it_runs_out() {
        let tokens = Tokens {
            access_token: "sw_a".into(),
            expires_in: 3600,
            refresh_token: "swr_b".into(),
            organization: Org {
                id: "o".into(),
                name: "Acme".into(),
            },
            organizations: vec![],
            environment: Some("prod".into()),
            role: "write".into(),
            email: None,
        };
        let session = Session::from(tokens, 1000);
        assert_eq!(session.expires_at, 4600);
        assert!(session.fresh(1000));
        assert!(session.fresh(4539));
        assert!(!session.fresh(4540));
        assert!(!session.fresh(9999));
    }

    #[tokio::test]
    async fn signed_out_until_signed_in() {
        let account = Account::new("http://127.0.0.1:9".into(), "http://127.0.0.1:9".into());
        *account.session.lock().await = Some(None);
        assert_eq!(account.token().await, Err(AuthError::SignedOut));
        assert!(account.profile().await.is_none());
    }
}
