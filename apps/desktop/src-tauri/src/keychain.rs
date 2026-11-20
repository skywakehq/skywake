//! The sign-in, kept in the macOS Keychain as one item and nowhere else: not
//! in a file, not in the window's storage. Only this app reads it without
//! asking you first.

use keyring::Entry;

use crate::auth::Session;

const SERVICE: &str = "dev.skywake.desktop";
const ACCOUNT: &str = "session";

fn entry() -> keyring::Result<Entry> {
    Entry::new(SERVICE, ACCOUNT)
}

pub fn load() -> Option<Session> {
    let text = entry().ok()?.get_password().ok()?;
    // An item this version can't read is a sign-in to make again.
    serde_json::from_str(&text).ok()
}

pub fn save(session: &Session) -> Result<(), String> {
    let text = serde_json::to_string(session).map_err(|error| error.to_string())?;
    entry()
        .and_then(|entry| entry.set_password(&text))
        .map_err(|error| format!("Could not save the sign-in to the Keychain ({error})."))
}

pub fn delete() {
    if let Ok(entry) = entry() {
        let _ = entry.delete_credential();
    }
}
