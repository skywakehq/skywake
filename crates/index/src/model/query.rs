//! A vector query and its hits.

use super::{Attributes, Filter, Id, Per};

#[derive(Clone, Debug)]
pub struct Query {
    pub column: String,
    pub vector: Vec<f32>,
    pub top_k: usize,
    pub recall: Option<f32>,
    pub probe: Option<usize>,
    pub filter: Option<Filter>,
    pub include: Vec<String>,
    pub offset: usize,
    pub per: Option<Per>,
}

impl Query {
    pub fn new(column: &str, vector: Vec<f32>, top_k: usize) -> Self {
        Self {
            column: column.to_string(),
            vector,
            top_k,
            recall: None,
            probe: None,
            filter: None,
            include: Vec::new(),
            offset: 0,
            per: None,
        }
    }

    pub fn recall(mut self, recall: f32) -> Self {
        self.recall = Some(recall);
        self
    }

    pub fn probe(mut self, probe: usize) -> Self {
        self.probe = Some(probe);
        self
    }

    pub fn filter(mut self, filter: Filter) -> Self {
        self.filter = Some(filter);
        self
    }

    pub fn include(mut self, names: &[&str]) -> Self {
        self.include = names.iter().map(|name| name.to_string()).collect();
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub id: Id,
    pub distance: f32,
    pub attributes: Attributes,
}
