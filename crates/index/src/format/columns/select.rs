use super::chunk::{Chunk, Data, Layout};
use super::dictionary::Dictionary;
use crate::{Filter, Value};

pub(crate) type Bits = Vec<u64>;

impl Chunk {
    pub(crate) fn select(&self, leaf: &Filter, layout: Layout, dictionary: &Dictionary) -> Bits {
        let rows = self.rows as usize;
        let mut bits = vec![0u64; rows.div_ceil(64)];
        let mut known = vec![0u8; dictionary.values.len()];
        let mut pass = |code: u32| {
            let at = code as usize;
            if known[at] == 0 {
                known[at] = 1 + u8::from(leaf.test(Some(&dictionary.values[at])));
            }
            known[at] == 2
        };
        match &self.data {
            Data::Empty => {}
            Data::Constant(code) => {
                if pass(*code) {
                    fill(&mut bits, 0, rows);
                }
            }
            Data::Runs { codes, ends } => {
                let mut start = 0;
                for (&code, &end) in codes.iter().zip(ends) {
                    if pass(code) {
                        fill(&mut bits, start, end as usize);
                    }
                    start = end as usize;
                }
            }
            Data::Frequent {
                common,
                rows: at,
                codes,
            } => {
                if pass(*common) {
                    fill(&mut bits, 0, rows);
                }
                for (&row, &code) in at.iter().zip(codes) {
                    set(&mut bits, row as usize, pass(code));
                }
            }
            Data::Codes(packed) => {
                for row in 0..rows {
                    set(&mut bits, row, pass(packed.get(row) as u32));
                }
            }
            Data::Ints { base, packed } => {
                for row in 0..rows {
                    let n = base.wrapping_add(packed.get(row) as i64);
                    let value = match layout {
                        Layout::Datetimes => Value::Datetime(n),
                        _ => Value::Int(n),
                    };
                    set(&mut bits, row, leaf.test(Some(&value)));
                }
            }
            Data::Floats(floats) => {
                for (row, &n) in floats.iter().enumerate() {
                    set(&mut bits, row, leaf.test(Some(&Value::Number(n))));
                }
            }
            Data::Values(values) => {
                for (row, value) in values.iter().enumerate() {
                    set(&mut bits, row, leaf.test(Some(value)));
                }
            }
        }
        if let Some(missing) = &self.missing {
            for (word, gone) in bits.iter_mut().zip(missing) {
                *word &= !gone;
            }
        }
        bits
    }
}

fn set(bits: &mut Bits, row: usize, on: bool) {
    let mask = 1u64 << (row % 64);
    match on {
        true => bits[row / 64] |= mask,
        false => bits[row / 64] &= !mask,
    }
}

fn fill(bits: &mut Bits, start: usize, end: usize) {
    let mut row = start;
    while row < end {
        match row.is_multiple_of(64) && row + 64 <= end {
            true => {
                bits[row / 64] = u64::MAX;
                row += 64;
            }
            false => {
                bits[row / 64] |= 1 << (row % 64);
                row += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::dictionary::Coder;
    use super::*;
    use crate::{Pattern, Syntax};

    struct Draw(u64);

    impl Draw {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn value(draw: &mut Draw, layout: Layout, spread: u64) -> Value {
        let n = draw.below(spread) as i64 - (spread / 3) as i64;
        match layout {
            Layout::Dictionary => Value::String(format!("s{n:03}")),
            Layout::Ints => Value::Int(n * 1_000),
            Layout::Datetimes => Value::Datetime(1_700_000_000_000 + n),
            Layout::Floats => Value::Number(n as f64 / 4.0),
            Layout::Values => {
                Value::Strings(vec![format!("s{n:03}"); (n % 3).unsigned_abs() as usize])
            }
        }
    }

    fn column(draw: &mut Draw, layout: Layout) -> Vec<Option<Value>> {
        let rows = 1 + draw.below(300) as usize;
        let spread = [1, 2, 5, 40, 1_000][draw.below(5) as usize];
        let missing = [0, 0, 10, 50, 100][draw.below(5) as usize];
        let shape = draw.below(3);
        let mut out = Vec::with_capacity(rows);
        let mut current = value(draw, layout, spread);
        for _ in 0..rows {
            if draw.below(100) < missing {
                out.push(None);
                continue;
            }
            let fresh = match shape {
                0 => true,
                1 => draw.below(20) == 0,
                _ => draw.below(10) == 0,
            };
            if fresh {
                current = value(draw, layout, spread);
            }
            out.push(Some(current.clone()));
        }
        out
    }

    fn leaf(draw: &mut Draw, layout: Layout) -> Filter {
        let operand = |draw: &mut Draw| match draw.below(4) {
            0 => Value::Int(draw.below(40) as i64 - 13),
            1 => Value::Number(draw.below(40) as f64 / 4.0 - 3.0),
            _ => match value(draw, layout, 40) {
                Value::Strings(list) => Value::String(list.first().cloned().unwrap_or_default()),
                other => other,
            },
        };
        let name = "a".to_string();
        match draw.below(9) {
            0 => Filter::Eq(name, operand(draw)),
            1 => Filter::In(name, vec![operand(draw), operand(draw), operand(draw)]),
            2 => Filter::Lt(name, operand(draw)),
            3 => Filter::Lte(name, operand(draw)),
            4 => Filter::Gt(name, operand(draw)),
            5 => Filter::Gte(name, operand(draw)),
            6 => Filter::ContainsAll(name, vec![operand(draw), operand(draw)]),
            7 => Filter::Exists(name),
            _ => Filter::Matches(name, Pattern::new("s0*", Syntax::Glob).unwrap()),
        }
    }

    #[test]
    fn every_encoding_selects_what_each_row_would() {
        let layouts = [
            Layout::Dictionary,
            Layout::Ints,
            Layout::Datetimes,
            Layout::Floats,
            Layout::Values,
        ];
        let mut draw = Draw(7);
        for case in 0..4_000 {
            let layout = layouts[case % layouts.len()];
            let values = column(&mut draw, layout);
            let mut coder = Coder::new(Dictionary::default());
            let as_dictionary = draw.below(2) == 0 && layout != Layout::Values;
            let encoded = if as_dictionary {
                Layout::Dictionary
            } else {
                layout
            };
            let chunk = Chunk::encode(&values, encoded, &mut coder);
            let dictionary = coder.finish();
            for _ in 0..8 {
                let leaf = leaf(&mut draw, layout);
                let bits = chunk.select(&leaf, encoded, &dictionary);
                for (row, value) in values.iter().enumerate() {
                    let on = bits[row / 64] >> (row % 64) & 1 == 1;
                    assert_eq!(
                        on,
                        leaf.test(value.as_ref()),
                        "{leaf:?} row {row} of {values:?}"
                    );
                }
                let extra = bits.len() * 64 - values.len();
                assert!(extra == 0 || bits[bits.len() - 1] >> (64 - extra) == 0);
            }
        }
    }
}
