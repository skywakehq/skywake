use std::fmt::Write;

use anyhow::{Result, anyhow};
use ring::rand::{SecureRandom, SystemRandom};

pub(crate) struct NewKey {
    pub(crate) id: String,
    pub(crate) key: String,
}

impl NewKey {
    pub(crate) fn make() -> Result<Self> {
        let id = hex(&random::<8>()?);
        let body = format!("sw_{id}_{}", hex(&random::<32>()?));
        let key = format!("{body}{:08x}", crc32fast::hash(body.as_bytes()));
        Ok(NewKey { id, key })
    }

    pub(crate) fn hash(&self) -> String {
        blake3::hash(self.key.as_bytes()).to_hex().to_string()
    }
}

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow!("no random numbers from the system"))?;
    Ok(bytes)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_hex(text: &str, len: usize) -> bool {
        text.len() == len
            && text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    #[test]
    fn keys_have_the_servers_shape_and_checksum() {
        let made = NewKey::make().unwrap();
        let rest = made.key.strip_prefix("sw_").unwrap();
        let (id, tail) = rest.split_once('_').unwrap();
        assert_eq!(id, made.id);
        assert!(is_hex(id, 16));
        assert!(is_hex(tail, 72));
        let (body, crc) = made.key.split_at(made.key.len() - 8);
        assert_eq!(
            u32::from_str_radix(crc, 16).unwrap(),
            crc32fast::hash(body.as_bytes())
        );
        assert!(is_hex(&made.hash(), 64));
        assert_ne!(NewKey::make().unwrap().key, made.key);
    }

    #[test]
    fn the_checksum_is_standard_crc32() {
        assert_eq!(crc32fast::hash(b"123456789"), 0xcbf4_3926);
    }
}
