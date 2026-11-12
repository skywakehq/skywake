//! `index-bench gen`: a synthetic dataset of points around random centers, like embeddings of many topics.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::json;

use super::files::Writer;
use super::random::Random;

const BLOCK: usize = 10_000;

const CENTERS_SEED: u64 = 42;
const ROWS_SEED: u64 = 1;
const QUERIES_SEED: u64 = 2;

#[derive(clap::Args)]
pub struct Args {
    #[arg(help = "The dataset folder to write")]
    dir: PathBuf,
    #[arg(long, default_value_t = 200_000)]
    rows: usize,
    #[arg(long, default_value_t = 768)]
    dims: usize,
    #[arg(long, default_value_t = 1000)]
    queries: usize,
}

pub fn generate(args: &Args) -> Result<()> {
    let Args {
        dir,
        rows,
        dims,
        queries,
    } = args;
    let (rows, dims, queries) = (*rows, *dims, *queries);
    std::fs::create_dir_all(dir)?;
    let centers = (rows / 100).max(1);
    let mut base = Clustered::new(dims, centers, ROWS_SEED);
    let mut writer = Writer::create(&dir.join("base.fbin"), rows, dims)?;
    for start in (0..rows).step_by(BLOCK) {
        for row in (&mut base).take(BLOCK.min(rows - start)) {
            writer.f32s(&row)?;
        }
    }
    writer.finish()?;
    let mut writer = Writer::create(&dir.join("query.fbin"), queries, dims)?;
    for row in Clustered::new(dims, centers, QUERIES_SEED).take(queries) {
        writer.f32s(&row)?;
    }
    writer.finish()?;
    std::fs::write(dir.join("metric"), "cosine\n")?;
    write_manifest(dir, rows, dims, queries)
}

fn write_manifest(dir: &Path, rows: usize, dims: usize, queries: usize) -> Result<()> {
    let manifest = json!({
        "source": "synthetic: points around rows / 100 centers, noise 1.5",
        "seeds": { "centers": CENTERS_SEED, "rows": ROWS_SEED, "queries": QUERIES_SEED },
        "rows": rows,
        "dims": dims,
        "queries": queries,
        "metric": "cosine",
    });
    std::fs::write(
        dir.join(super::MANIFEST),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    Ok(())
}

struct Clustered {
    centers: Vec<Vec<f32>>,
    random: Random,
}

impl Clustered {
    fn new(dims: usize, centers: usize, seed: u64) -> Self {
        let mut random = Random(CENTERS_SEED);
        let centers = (0..centers)
            .map(|_| (0..dims).map(|_| random.normal()).collect())
            .collect();
        Self {
            centers,
            random: Random(seed),
        }
    }
}

impl Iterator for Clustered {
    type Item = Vec<f32>;

    fn next(&mut self) -> Option<Vec<f32>> {
        let center = &self.centers[self.random.next() as usize % self.centers.len()];
        Some(
            center
                .iter()
                .map(|x| x + 1.5 * self.random.normal())
                .collect(),
        )
    }
}
