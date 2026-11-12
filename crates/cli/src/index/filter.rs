//! A filter in words, such as `tag = billing and price < 10`, as the API's JSON.

use anyhow::{Result, bail};
use serde_json::{Value, json};

pub(super) fn parse(text: &str) -> Result<Value> {
    let text = text.trim();
    if text.starts_with('{') {
        return Ok(serde_json::from_str(text)?);
    }
    let mut parser = Parser {
        tokens: tokens(text)?,
        at: 0,
    };
    let filter = parser.any()?;
    if let Some(token) = parser.tokens.get(parser.at) {
        bail!(
            "filter: unexpected {} at {}; join parts with `and` or `or`",
            token.show(),
            token.at + 1
        );
    }
    Ok(filter)
}

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Word(String),
    Text(String),
    Number(serde_json::Number),
    Symbol(&'static str),
}

#[derive(Debug, Clone)]
struct Token {
    kind: Kind,
    at: usize,
}

impl Token {
    fn show(&self) -> String {
        match &self.kind {
            Kind::Word(word) => format!("`{word}`"),
            Kind::Text(text) => format!("\"{text}\""),
            Kind::Number(number) => format!("`{number}`"),
            Kind::Symbol(symbol) => format!("`{symbol}`"),
        }
    }

    fn is(&self, word: &str) -> bool {
        matches!(&self.kind, Kind::Word(w) if w.eq_ignore_ascii_case(word))
    }
}

const SYMBOLS: [&str; 10] = ["==", "!=", "<=", ">=", "=", "<", ">", "(", ")", ","];

fn tokens(text: &str) -> Result<Vec<Token>> {
    let chars: Vec<char> = text.chars().collect();
    let rest = |i: usize| chars[i..].iter().collect::<String>();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let start = i;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            let mut value = String::new();
            i += 1;
            loop {
                match chars.get(i) {
                    None => bail!("filter: the string at {} never ends", start + 1),
                    Some('\\') if chars.get(i + 1).is_some() => {
                        value.push(chars[i + 1]);
                        i += 2;
                    }
                    Some(&end) if end == c => break,
                    Some(&other) => {
                        value.push(other);
                        i += 1;
                    }
                }
            }
            i += 1;
            out.push(Token {
                kind: Kind::Text(value),
                at: start,
            });
            continue;
        }
        if let Some(symbol) = SYMBOLS.iter().find(|s| rest(i).starts_with(**s)) {
            i += symbol.len();
            out.push(Token {
                kind: Kind::Symbol(symbol),
                at: start,
            });
            continue;
        }
        while i < chars.len() && !chars[i].is_whitespace() && !"\"'=!<>(),".contains(chars[i]) {
            i += 1;
        }
        if i == start {
            bail!("filter: unexpected `{c}` at {}", start + 1);
        }
        let word: String = chars[start..i].iter().collect();
        let kind = match word.parse::<serde_json::Number>() {
            Ok(number) => Kind::Number(number),
            Err(_) => Kind::Word(word),
        };
        out.push(Token { kind, at: start });
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn next(&mut self, wanted: &str) -> Result<Token> {
        match self.tokens.get(self.at) {
            Some(token) => {
                self.at += 1;
                Ok(token.clone())
            }
            None => bail!("filter: it ends where {wanted} should come"),
        }
    }

    fn eat_word(&mut self, word: &str) -> bool {
        let found = self.peek().is_some_and(|token| token.is(word));
        self.at += found as usize;
        found
    }

    fn eat_symbol(&mut self, symbol: &str) -> bool {
        let found =
            matches!(self.peek(), Some(Token { kind: Kind::Symbol(s), .. }) if *s == symbol);
        self.at += found as usize;
        found
    }

    fn any(&mut self) -> Result<Value> {
        let mut parts = vec![self.all()?];
        while self.eat_word("or") {
            parts.push(self.all()?);
        }
        Ok(join("or", parts))
    }

    fn all(&mut self) -> Result<Value> {
        let mut parts = vec![self.one()?];
        while self.eat_word("and") {
            parts.push(self.one()?);
        }
        Ok(join("and", parts))
    }

    fn one(&mut self) -> Result<Value> {
        if self.eat_word("not") {
            return Ok(json!({ "not": self.one()? }));
        }
        if self.eat_symbol("(") {
            let inner = self.any()?;
            if !self.eat_symbol(")") {
                bail!("filter: a `(` is never closed");
            }
            return Ok(inner);
        }
        self.compare()
    }

    fn compare(&mut self) -> Result<Value> {
        let token = self.next("an attribute name")?;
        let name = match &token.kind {
            Kind::Word(word) if !["and", "or", "in"].contains(&word.to_lowercase().as_str()) => {
                word.clone()
            }
            _ => bail!(
                "filter: expected an attribute name at {}, found {}",
                token.at + 1,
                token.show()
            ),
        };
        let negate = self.eat_word("not");
        if self.eat_word("in") {
            if !self.eat_symbol("(") {
                bail!("filter: write a list after `in` as (a, b, c)");
            }
            let mut values = vec![self.value()?];
            while self.eat_symbol(",") {
                values.push(self.value()?);
            }
            if !self.eat_symbol(")") {
                bail!("filter: the list after `{name} in` needs a closing `)`");
            }
            let test = json!({ name: { "in": values } });
            return Ok(if negate { json!({ "not": test }) } else { test });
        }
        if negate {
            bail!("filter: `not` after `{name}` must come before `in`");
        }
        let op = self.next("an operator")?;
        let (op, negate) = match op.kind {
            Kind::Symbol("=" | "==") => ("eq", false),
            Kind::Symbol("!=") => ("eq", true),
            Kind::Symbol("<") => ("lt", false),
            Kind::Symbol("<=") => ("lte", false),
            Kind::Symbol(">") => ("gt", false),
            Kind::Symbol(">=") => ("gte", false),
            _ => bail!(
                "filter: expected an operator after `{name}` (=, !=, <, <=, >, >=, in), found {}",
                op.show()
            ),
        };
        let test = json!({ name: { op: self.value()? } });
        Ok(if negate { json!({ "not": test }) } else { test })
    }

    fn value(&mut self) -> Result<Value> {
        let token = self.next("a value")?;
        Ok(match token.kind {
            Kind::Number(number) => Value::Number(number),
            Kind::Text(text) => Value::String(text),
            Kind::Word(word) if word == "true" => Value::Bool(true),
            Kind::Word(word) if word == "false" => Value::Bool(false),
            Kind::Word(word) => Value::String(word),
            Kind::Symbol(_) => bail!(
                "filter: expected a value at {}, found {}",
                token.at + 1,
                token.show()
            ),
        })
    }
}

fn join(word: &str, parts: Vec<Value>) -> Value {
    if parts.len() == 1 {
        return parts.into_iter().next().unwrap_or(Value::Null);
    }
    let mut flat = Vec::new();
    for part in parts {
        match part.get(word) {
            Some(Value::Array(inner)) if part.as_object().is_some_and(|o| o.len() == 1) => {
                flat.extend(inner.iter().cloned())
            }
            _ => flat.push(part),
        }
    }
    json!({ word: flat })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(text: &str) -> Value {
        parse(text).unwrap()
    }

    fn error(text: &str) -> String {
        parse(text).unwrap_err().to_string()
    }

    #[test]
    fn a_comparison_names_its_operator() {
        assert_eq!(ok("tag = billing"), json!({"tag": {"eq": "billing"}}));
        assert_eq!(ok("price<=9.5"), json!({"price": {"lte": 9.5}}));
        assert_eq!(ok("price > -1"), json!({"price": {"gt": -1}}));
        assert_eq!(ok("live == true"), json!({"live": {"eq": true}}));
        assert_eq!(
            ok("day >= 2026-01-01"),
            json!({"day": {"gte": "2026-01-01"}})
        );
        assert_eq!(ok("name = 'a b'"), json!({"name": {"eq": "a b"}}));
        assert_eq!(ok(r#"sku = "42""#), json!({"sku": {"eq": "42"}}));
    }

    #[test]
    fn not_equal_and_not_in_are_negations() {
        assert_eq!(ok("tag != x"), json!({"not": {"tag": {"eq": "x"}}}));
        assert_eq!(
            ok("tag not in (a, 'b c', 3)"),
            json!({"not": {"tag": {"in": ["a", "b c", 3]}}})
        );
    }

    #[test]
    fn and_binds_tighter_than_or() {
        assert_eq!(
            ok("a = 1 or b = 2 and c = 3"),
            json!({"or": [{"a": {"eq": 1}}, {"and": [{"b": {"eq": 2}}, {"c": {"eq": 3}}]}]})
        );
        assert_eq!(
            ok("(a = 1 or b = 2) AND not c = 3 and d < 4"),
            json!({"and": [
                {"or": [{"a": {"eq": 1}}, {"b": {"eq": 2}}]},
                {"not": {"c": {"eq": 3}}},
                {"d": {"lt": 4}},
            ]})
        );
    }

    #[test]
    fn json_passes_through() {
        assert_eq!(ok(r#"{"tag": {"eq": "x"}}"#), json!({"tag": {"eq": "x"}}));
    }

    #[test]
    fn mistakes_say_where() {
        assert_eq!(
            error("price 10"),
            "filter: expected an operator after `price` (=, !=, <, <=, >, >=, in), found `10`"
        );
        assert_eq!(error("tag = "), "filter: it ends where a value should come");
        assert_eq!(
            error("a = 1 b = 2"),
            "filter: unexpected `b` at 7; join parts with `and` or `or`"
        );
        assert_eq!(error("(a = 1"), "filter: a `(` is never closed");
        assert_eq!(error("tag = 'x"), "filter: the string at 7 never ends");
        assert_eq!(
            error("tag in a"),
            "filter: write a list after `in` as (a, b, c)"
        );
    }
}
