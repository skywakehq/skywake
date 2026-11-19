//! Loads of one object asked for at once share a single fetch.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use skywake_core::Hash;
use tokio::sync::watch;

#[derive(Default)]
pub(crate) struct Flights(Mutex<HashMap<Hash, watch::Receiver<()>>>);

pub(crate) enum Turn<'a> {
    Load(Flight<'a>),
    Wait(watch::Receiver<()>),
}

pub(crate) struct Flight<'a> {
    flights: &'a Flights,
    key: Hash,
    _landed: watch::Sender<()>,
}

impl Flights {
    pub(crate) fn join(&self, key: Hash) -> Turn<'_> {
        let mut flights = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(waiting) = flights.get(&key) {
            return Turn::Wait(waiting.clone());
        }
        let (landed, waiting) = watch::channel(());
        flights.insert(key, waiting);
        Turn::Load(Flight {
            flights: self,
            key,
            _landed: landed,
        })
    }
}

impl Drop for Flight<'_> {
    fn drop(&mut self) {
        let mut flights = (self.flights.0.lock()).unwrap_or_else(PoisonError::into_inner);
        flights.remove(&self.key);
    }
}
