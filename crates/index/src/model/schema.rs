//! The schema: vector columns, attributes and their kinds.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::IdKind;
use crate::text::TextOptions;
use crate::{Result, invalid};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Metric {
    Cosine,
    Euclidean,
    Dot,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Element {
    #[default]
    F32,
    F16,
    I8,
}

impl Element {
    pub fn bytes(self) -> usize {
        match self {
            Element::F32 => 4,
            Element::F16 => 2,
            Element::I8 => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Column {
    pub dims: usize,
    pub metric: Metric,
    pub element: Element,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    String,
    Number,
    Bool,
    Strings,
    Int,
    Uuid,
    Datetime,
    Ints,
    Numbers,
    Sparse,
    Vectors,
}

impl Kind {
    pub fn item(self) -> Kind {
        match self {
            Kind::Strings => Kind::String,
            Kind::Ints => Kind::Int,
            Kind::Numbers => Kind::Number,
            kind => kind,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Schema {
    pub vectors: BTreeMap<String, Column>,
    pub attributes: BTreeMap<String, Kind>,
    pub text: BTreeMap<String, TextOptions>,
    pub id: IdKind,
    pub filter_index: BTreeSet<String>,
    /// Attributes taken out. One may come back only as it was, since older
    /// parts still index it that way.
    pub dropped: BTreeMap<String, (Kind, Option<TextOptions>)>,
}

impl Schema {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn vector(self, name: &str, dims: usize, metric: Metric) -> Self {
        self.vector_of(name, dims, metric, Element::F32)
    }

    pub fn vector_of(mut self, name: &str, dims: usize, metric: Metric, element: Element) -> Self {
        let column = Column {
            dims,
            metric,
            element,
        };
        self.vectors.insert(name.to_string(), column);
        self
    }

    pub fn attribute(mut self, name: &str, kind: Kind) -> Self {
        self.attributes.insert(name.to_string(), kind);
        self
    }

    pub fn text(mut self, name: &str, options: TextOptions) -> Self {
        let kind = if options.pre_tokenized {
            Kind::Strings
        } else {
            Kind::String
        };
        self.attributes.insert(name.to_string(), kind);
        self.text.insert(name.to_string(), options);
        self
    }

    pub fn filter_index(mut self, name: &str) -> Self {
        self.filter_index.insert(name.to_string());
        self
    }

    pub fn uuid_ids(mut self) -> Self {
        self.id = IdKind::Uuid;
        self
    }

    pub(crate) fn check(&self) -> Result<()> {
        if self.vectors.is_empty() && self.text.is_empty() {
            return Err(invalid(
                "an index needs a vector column or a text attribute",
            ));
        }
        for (name, options) in &self.text {
            let kind = if options.pre_tokenized {
                Kind::Strings
            } else {
                Kind::String
            };
            if self.attributes.get(name) != Some(&kind) {
                return Err(invalid(format!(
                    "text attribute `{name}` must be a {}",
                    if options.pre_tokenized {
                        "list of strings"
                    } else {
                        "string"
                    }
                )));
            }
            if options.max_token == 0 {
                return Err(invalid(format!(
                    "`{name}` needs a max token length of 1 or more"
                )));
            }
            if !options.k1.is_finite() || options.k1 < 0.0 || !(0.0..=1.0).contains(&options.b) {
                return Err(invalid(format!(
                    "`{name}` needs k1 of 0 or more and b from 0 to 1"
                )));
            }
            if options.stopwords && options.language.stopwords().is_none() {
                return Err(invalid(format!(
                    "`{name}`: there is no stopword list for {}",
                    options.language.name()
                )));
            }
        }
        for name in &self.filter_index {
            let sorts = matches!(
                self.attributes.get(name),
                Some(
                    Kind::String
                        | Kind::Number
                        | Kind::Int
                        | Kind::Bool
                        | Kind::Uuid
                        | Kind::Datetime
                )
            );
            if !sorts {
                return Err(invalid(format!(
                    "`{name}`: a filter index takes a string, number, int, bool, uuid or datetime attribute"
                )));
            }
        }
        if let Some((name, _)) = self.vectors.iter().find(|(_, column)| column.dims == 0) {
            return Err(invalid(format!("vector column `{name}` has no dimensions")));
        }
        if let Some((name, _)) = (self.vectors.iter())
            .find(|(_, c)| c.element == Element::I8 && c.metric == Metric::Cosine)
        {
            return Err(invalid(format!(
                "`{name}`: i8 vectors take euclidean or dot; normalize them before quantizing and use dot"
            )));
        }
        Ok(())
    }

    pub(crate) fn merge(&self, other: &Schema) -> Result<Schema> {
        if let Some((name, _)) =
            (other.vectors.iter()).find(|(n, c)| self.vectors.get(*n) != Some(c))
        {
            return Err(invalid(format!(
                "vector column `{name}` can't be added or changed"
            )));
        }
        let mut merged = self.clone();
        for (name, &kind) in &other.attributes {
            let text = other.text.get(name);
            match self.attributes.get(name) {
                None if (self.dropped.get(name))
                    .is_some_and(|was| *was != (kind, text.copied())) =>
                {
                    return Err(invalid(format!(
                        "attribute `{name}` was dropped; it can come back only as it was"
                    )));
                }
                None => {
                    merged.dropped.remove(name);
                    merged.attributes.insert(name.clone(), kind);
                    if let Some(&options) = text {
                        merged.text.insert(name.clone(), options);
                    }
                }
                Some(&had) if had == kind && self.text.get(name) == text => {}
                Some(_) => return Err(invalid(format!("attribute `{name}` can't change"))),
            }
        }
        merged
            .filter_index
            .extend(other.filter_index.iter().cloned());
        Ok(merged)
    }

    /// The schema without these attributes.
    pub(crate) fn without(&self, names: &[String]) -> Result<Schema> {
        let mut left = self.clone();
        for name in names {
            if self.vectors.contains_key(name) {
                return Err(invalid(format!("vector column `{name}` can't be dropped")));
            }
            let kind = (left.attributes.remove(name))
                .ok_or_else(|| invalid(format!("no attribute `{name}`")))?;
            let text = left.text.remove(name);
            left.filter_index.remove(name);
            left.dropped.insert(name.clone(), (kind, text));
        }
        Ok(left)
    }

    pub(crate) fn kind(&self, name: &str) -> Result<Kind> {
        (self.attributes.get(name).copied())
            .ok_or_else(|| invalid(format!("no attribute `{name}`")))
    }
}
