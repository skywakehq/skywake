//! A two-level directory over a column's clusters, so a query reads only some centroids.

use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use super::cluster::ClusterRef;
use super::pages::Pages;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Directory {
    pub per_page: u32,
    pub tops: Vec<f32>,
    pub radii: Vec<f32>,
    pub sizes: Vec<u32>,
    pub pages: Vec<Hash>,
    pub slots: Pages,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Page {
    pub clusters: Vec<u32>,
    pub centroids: Vec<f32>,
    pub table: Vec<ClusterRef>,
}

pub(crate) type Slot = (u32, u32);
