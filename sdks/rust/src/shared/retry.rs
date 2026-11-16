use std::time::Duration;

use reqwest::Method;

pub(crate) const MAX_WAIT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
pub(crate) struct Retry {
    pub retries: u32,
    pub backoff: Duration,
}

impl Retry {
    pub fn wait(&self, attempt: u32) -> Duration {
        let most = self.backoff.as_secs_f64() * 2f64.powi(attempt as i32);
        Duration::from_secs_f64(fastrand::f64() * most.min(MAX_WAIT.as_secs_f64()))
    }
}

pub(crate) fn idempotent(method: &Method) -> bool {
    matches!(
        *method,
        Method::GET | Method::HEAD | Method::PUT | Method::DELETE | Method::OPTIONS
    )
}
