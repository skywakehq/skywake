//! Percentiles, each with the definition its published numbers were computed with.

pub(crate) mod memory;
pub(crate) mod requests;

use std::time::Duration;

pub(crate) fn millis(times: &[Duration]) -> Vec<f64> {
    times.iter().map(|t| t.as_secs_f64() * 1e3).collect()
}

pub(crate) fn floor_rank(ms: &[f64], p: f64) -> f64 {
    let ms = sorted(ms);
    let i = ((ms.len() as f64 * p) as usize).min(ms.len().saturating_sub(1));
    ms.get(i).copied().unwrap_or(0.0)
}

pub(crate) fn nearest_rank(ms: &[f64], p: f64) -> f64 {
    let ms = sorted(ms);
    let i = ((ms.len() as f64 * p).ceil() as usize).clamp(1, ms.len().max(1)) - 1;
    ms.get(i).copied().unwrap_or(0.0)
}

pub(crate) fn lower_rank(ms: &[f64], p: f64) -> f64 {
    let ms = sorted(ms);
    let i = (p * ms.len().saturating_sub(1) as f64) as usize;
    ms.get(i).map_or(0.0, |v| (v * 10.0).round() / 10.0)
}

fn sorted(ms: &[f64]) -> Vec<f64> {
    let mut ms = ms.to_vec();
    ms.sort_by(f64::total_cmp);
    ms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_definition_picks_its_rank() {
        let ms: Vec<f64> = (1..=10).rev().map(f64::from).collect();
        assert_eq!(floor_rank(&ms, 0.5), 6.0);
        assert_eq!(floor_rank(&ms, 0.99), 10.0);
        assert_eq!(nearest_rank(&ms, 0.5), 5.0);
        assert_eq!(nearest_rank(&ms, 0.9), 9.0);
        assert_eq!(lower_rank(&ms, 0.5), 5.0);
        assert_eq!(lower_rank(&ms, 0.99), 9.0);
        assert_eq!(floor_rank(&[], 0.5), 0.0);
        assert_eq!(nearest_rank(&[], 0.5), 0.0);
    }
}
