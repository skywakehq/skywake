use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::{Kind, Value};

pub(crate) const LEADERS: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Leaders {
    pub high: Ranked,
    pub low: Ranked,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Ranked {
    pub rows: Vec<Leader>,
    pub edge: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Leader {
    pub value: Value,
    pub page: u32,
    pub row: u32,
}

impl Leaders {
    pub(crate) fn side(&self, descending: bool) -> &Ranked {
        match descending {
            true => &self.high,
            false => &self.low,
        }
    }
}

pub(crate) fn ranks(kind: Kind) -> bool {
    matches!(kind, Kind::Number | Kind::Int | Kind::Datetime)
}

pub(crate) struct Gather {
    high: Side,
    low: Side,
    broken: bool,
}

impl Gather {
    pub(crate) fn new() -> Self {
        Self {
            high: Side::new(true),
            low: Side::new(false),
            broken: false,
        }
    }

    pub(crate) fn page(&mut self, page: usize, values: &[Option<Value>]) {
        if self.broken {
            return;
        }
        let present: Vec<Leader> = (values.iter().enumerate())
            .filter_map(|(row, value)| {
                Some(Leader {
                    value: value.clone()?,
                    page: page as u32,
                    row: row as u32,
                })
            })
            .collect();
        if present.iter().any(|leader| !orderable(&leader.value)) {
            self.broken = true;
            return;
        }
        self.high.page(present.clone());
        self.low.page(present);
    }

    pub(crate) fn keep(&mut self, old: Option<&Leaders>, at: usize, page: usize) {
        match old {
            None => self.broken = true,
            Some(old) => {
                self.high.keep(&old.high, at, page);
                self.low.keep(&old.low, at, page);
            }
        }
    }

    pub(crate) fn finish(self) -> Option<Leaders> {
        (!self.broken).then(|| Leaders {
            high: self.high.finish(),
            low: self.low.finish(),
        })
    }
}

fn rank(descending: bool, a: &Value, b: &Value) -> Ordering {
    match descending {
        true => b.order(a),
        false => a.order(b),
    }
}

fn orderable(value: &Value) -> bool {
    match value {
        Value::Number(n) => !n.is_nan(),
        Value::Int(_) | Value::Datetime(_) => true,
        _ => false,
    }
}

struct Side {
    descending: bool,
    rows: Vec<Leader>,
    edge: Option<Value>,
}

impl Side {
    fn new(descending: bool) -> Self {
        Self {
            descending,
            rows: Vec::new(),
            edge: None,
        }
    }

    fn page(&mut self, mut present: Vec<Leader>) {
        let descending = self.descending;
        if present.len() > LEADERS {
            present.select_nth_unstable_by(LEADERS, |a, b| rank(descending, &a.value, &b.value));
            let rest = present.split_off(LEADERS);
            let best = rest
                .into_iter()
                .min_by(|a, b| rank(descending, &a.value, &b.value));
            self.raise(best.map(|leader| leader.value));
        }
        self.rows.extend(present);
        if self.rows.len() > 2 * LEADERS {
            self.trim();
        }
    }

    fn keep(&mut self, old: &Ranked, at: usize, page: usize) {
        let carried = (old.rows.iter())
            .filter(|leader| leader.page as usize == at)
            .map(|leader| Leader {
                page: page as u32,
                ..leader.clone()
            });
        self.rows.extend(carried);
        self.raise(old.edge.clone());
        if self.rows.len() > 2 * LEADERS {
            self.trim();
        }
    }

    fn raise(&mut self, value: Option<Value>) {
        let Some(value) = value else {
            return;
        };
        let higher = match &self.edge {
            None => true,
            Some(edge) => rank(self.descending, &value, edge) == Ordering::Less,
        };
        if higher {
            self.edge = Some(value);
        }
    }

    fn trim(&mut self) {
        let descending = self.descending;
        self.rows
            .sort_by(|a, b| rank(descending, &a.value, &b.value));
        if self.rows.len() > LEADERS {
            let dropped = self.rows[LEADERS].value.clone();
            self.rows.truncate(LEADERS);
            self.raise(Some(dropped));
        }
    }

    fn finish(mut self) -> Ranked {
        self.trim();
        if let Some(edge) = &self.edge {
            let descending = self.descending;
            self.rows
                .retain(|leader| rank(descending, &leader.value, edge) == Ordering::Less);
        }
        Ranked {
            rows: self.rows,
            edge: self.edge,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbers(values: &[f64]) -> Vec<Option<Value>> {
        values.iter().map(|&n| Some(Value::Number(n))).collect()
    }

    fn top(ranked: &Ranked) -> Vec<f64> {
        (ranked.rows.iter())
            .map(|leader| match leader.value {
                Value::Number(n) => n,
                _ => unreachable!(),
            })
            .collect()
    }

    #[test]
    fn every_unlisted_row_is_no_better_than_the_edge() {
        let mut gather = Gather::new();
        for page in 0..10 {
            let values: Vec<f64> = (0..500)
                .map(|i| ((i * 37 + page * 11) % 1000) as f64)
                .collect();
            gather.page(page, &numbers(&values));
        }
        let leaders = gather.finish().unwrap();
        let high = top(&leaders.high);
        assert!(high.len() <= LEADERS);
        assert!(high.windows(2).all(|w| w[0] >= w[1]));
        let Some(Value::Number(edge)) = leaders.high.edge else {
            panic!("ten pages of 500 rows overflow the list");
        };
        assert!(high.iter().all(|&n| n > edge));
        assert_eq!(high.first(), Some(&999.0));
        let low = top(&leaders.low);
        assert_eq!(low.first(), Some(&0.0));
        assert!(low.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn a_small_column_lists_every_row() {
        let mut gather = Gather::new();
        gather.page(0, &[Some(Value::Int(3)), None, Some(Value::Int(9))]);
        let leaders = gather.finish().unwrap();
        assert_eq!(leaders.high.edge, None);
        assert_eq!(leaders.high.rows.len(), 2);
        assert_eq!(
            (leaders.high.rows[0].page, leaders.high.rows[0].row),
            (0, 2)
        );
    }

    #[test]
    fn kept_pages_move_their_leaders_and_carry_the_edge() {
        let mut gather = Gather::new();
        gather.page(0, &numbers(&[1.0, 2.0]));
        gather.page(1, &numbers(&[5.0, 6.0]));
        let old = gather.finish().unwrap();
        let mut gather = Gather::new();
        gather.keep(Some(&old), 1, 0);
        let leaders = gather.finish().unwrap();
        assert_eq!(top(&leaders.high), vec![6.0, 5.0]);
        assert!(leaders.high.rows.iter().all(|leader| leader.page == 0));
    }

    #[test]
    fn nan_or_an_unknown_old_page_turns_leaders_off() {
        let mut gather = Gather::new();
        gather.page(0, &numbers(&[1.0, f64::NAN]));
        assert!(gather.finish().is_none());
        let mut gather = Gather::new();
        gather.keep(None, 0, 0);
        assert!(gather.finish().is_none());
    }
}
