//! The requests a store saw, and the dependent round trips (waves) they took.

use std::sync::{Mutex, PoisonError};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Op {
    Get,
    Head,
    Put,
    List,
    Other,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Request {
    pub op: Op,
    pub bytes: u64,
    pub started: Instant,
    pub ended: Instant,
}

#[derive(Default, Debug)]
pub(crate) struct Log(Mutex<Vec<Request>>);

impl Log {
    pub(crate) fn take(&self) -> Vec<Request> {
        std::mem::take(&mut self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// Reads and writes so far, without taking them: (gets, bytes read, puts, bytes written).
    pub(crate) fn totals(&self) -> (u64, u64, u64, u64) {
        let requests = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let mut totals = (0, 0, 0, 0);
        for request in requests.iter() {
            match request.op {
                Op::Get => (totals.0, totals.1) = (totals.0 + 1, totals.1 + request.bytes),
                Op::Put => (totals.2, totals.3) = (totals.2 + 1, totals.3 + request.bytes),
                _ => {}
            }
        }
        totals
    }

    pub(crate) fn add(&self, op: Op, bytes: u64, started: Instant) {
        let request = Request {
            op,
            bytes,
            started,
            ended: Instant::now(),
        };
        (self.0.lock().unwrap_or_else(PoisonError::into_inner)).push(request);
    }
}

pub(crate) fn count(requests: &[Request], op: Op) -> u64 {
    requests.iter().filter(|r| r.op == op).count() as u64
}

pub(crate) fn waves(requests: &[Request]) -> usize {
    let mut requests = requests.to_vec();
    requests.sort_by_key(|request| request.started);
    let mut waves = 0;
    let mut first_end = None;
    for request in requests {
        match first_end {
            Some(end) if request.started < end => first_end = Some(request.ended.min(end)),
            _ => {
                waves += 1;
                first_end = Some(request.ended);
            }
        }
    }
    waves
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn at(start: u64, end: u64) -> Request {
        let zero = Instant::now();
        Request {
            op: Op::Get,
            bytes: 0,
            started: zero + Duration::from_millis(start),
            ended: zero + Duration::from_millis(end),
        }
    }

    #[test]
    fn counts_dependent_waves() {
        assert_eq!(waves(&[]), 0);
        assert_eq!(waves(&[at(0, 60), at(1, 61), at(62, 120)]), 2);
        assert_eq!(waves(&[at(0, 10), at(1, 60), at(20, 30)]), 2);
        assert_eq!(waves(&[at(0, 60), at(70, 130), at(140, 200)]), 3);
    }
}
