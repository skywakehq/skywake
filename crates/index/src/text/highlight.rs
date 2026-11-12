//! Highlights: the part of a text that best matches the query.

use std::collections::HashSet;

use super::fields::analyzer;
use super::{Highlight, TextOptions};

pub(crate) const SIZE: usize = 200;

const LEAD: usize = 40;

pub(crate) fn highlight(
    text: &str,
    options: &TextOptions,
    terms: &HashSet<String>,
    prefixes: &[String],
) -> Highlight {
    let mut analyzer = analyzer(options);
    let mut stream = analyzer.token_stream(text);
    let mut matched: Vec<(usize, usize, String)> = Vec::new();
    while stream.advance() {
        let token = stream.token();
        let hit = terms.contains(&token.text)
            || prefixes.iter().any(|prefix| token.text.starts_with(prefix));
        if hit {
            matched.push((token.offset_from, token.offset_to, token.text.clone()));
        }
    }
    let (start, end) = window(text, &matched);
    let fragment = &text[start..end];
    let utf16 = |byte: usize| fragment[..byte].encode_utf16().count() as u32;
    let marks = (matched.iter())
        .filter(|(from, to, _)| *from >= start && *to <= end)
        .map(|(from, to, _)| (utf16(from - start), utf16(to - start)))
        .collect();
    Highlight {
        text: fragment.to_string(),
        marks,
    }
}

fn window(text: &str, matched: &[(usize, usize, String)]) -> (usize, usize) {
    if text.len() <= SIZE {
        return (0, text.len());
    }
    let mut best = (0, 0);
    for (i, (from, _, _)) in matched.iter().enumerate() {
        let start = from.saturating_sub(LEAD);
        let distinct: HashSet<&str> = (matched[i..].iter())
            .take_while(|(_, to, _)| *to <= start + SIZE)
            .map(|(_, _, term)| term.as_str())
            .collect();
        if distinct.len() > best.1 {
            best = (start, distinct.len());
        }
    }
    let mut start = floor(text, best.0);
    if start > 0
        && let Some(space) = text[start..floor(text, start + LEAD)].find(char::is_whitespace)
    {
        start += space + 1;
    }
    (start, floor(text, start + SIZE))
}

fn floor(text: &str, byte: usize) -> usize {
    let mut byte = byte.min(text.len());
    while !text.is_char_boundary(byte) {
        byte -= 1;
    }
    byte
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_marked_whole_in_utf16() {
        let terms: HashSet<String> = ["password".to_string()].into();
        let found = highlight(
            "Réset your Password now",
            &TextOptions::default(),
            &terms,
            &[],
        );
        assert_eq!(found.text, "Réset your Password now");
        assert_eq!(found.marks, [(11, 19)]);
        let prefixed = highlight(
            "reset passwords",
            &TextOptions::default(),
            &HashSet::new(),
            &["pass".into()],
        );
        assert_eq!(prefixed.marks, [(6, 15)]);
    }

    #[test]
    fn long_text_keeps_the_densest_window() {
        let filler = "lorem ipsum dolor ".repeat(30);
        let text = format!("{filler}the reset of a password is easy {filler}");
        let terms: HashSet<String> = ["reset".to_string(), "password".to_string()].into();
        let found = highlight(&text, &TextOptions::default(), &terms, &[]);
        assert!(found.text.len() <= SIZE);
        assert!(found.text.contains("reset of a password"));
        assert_eq!(found.marks.len(), 2);
        let (a, b) = found.marks[0];
        let marked: String = found.text.encode_utf16().collect::<Vec<_>>()[a as usize..b as usize]
            .iter()
            .map(|&u| u as u8 as char)
            .collect();
        assert_eq!(marked, "reset");
    }
}
