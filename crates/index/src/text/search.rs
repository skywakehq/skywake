//! The text query path.

use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet};
use std::ops::Bound;
use std::sync::Arc;

use futures::FutureExt;
use futures::future::{BoxFuture, try_join_all};
use tantivy::query::{
    AllQuery, BitSetDocSet, Bm25StatisticsProvider, Bm25Weight, BooleanQuery, BoostQuery,
    ConstScorer, DfaWrapper, EmptyQuery, EnableScoring, FuzzyTermQuery, Occur, PhrasePrefixQuery,
    PhraseQuery, Query as _, RangeQuery, TermQuery, TermSetQuery, Weight,
};
use tantivy::schema::{Field, IndexRecordOption, Schema as Tantivy};
use tantivy::{DocAddress, DocSet, Score, TERMINATED, TantivyDocument, Term};
use tantivy_fst::Automaton;

use super::fields::{Fields, analyzer, key, prefix_analyzer, tokens};
use super::highlight::highlight;
use super::part::{self, Opened, blocking};
use super::tail::{TailText, analyzed, holds};
use super::{Match, TextHit, TextOptions, TextQuery, engine};
use crate::format::Version;
use crate::read::tail::{Row, Tail};
use crate::store::Storage;
use crate::{Attributes, Error, Filter, Id, Kind, Result, Schema, Value, invalid, uuid_text};

const MAX_EXPANSIONS: usize = 1000;

type Clauses = Vec<(usize, Field, String, f32)>;

pub(crate) async fn search(
    storage: &Storage,
    version: &Version,
    query: &TextQuery,
) -> Result<Vec<TextHit>> {
    let parts = version.text.as_ref().map_or(&[][..], |text| &text.parts);
    let (tail, opened) = futures::try_join!(
        Tail::load(storage, version),
        try_join_all(
            parts
                .iter()
                .map(|p| part::open(storage, p.hot, p.hot_bytes))
        )
    )?;
    let mut plan = Plan::new(&version.schema, part::widest(&opened), query)?;
    if (plan.clauses.is_empty() && plan.prefixes.is_empty()) || query.top_k == 0 {
        return Ok(Vec::new());
    }
    let texts = try_join_all(
        (version.tail.iter().zip(&tail.segments))
            .map(|(r, (_, seg))| analyzed(storage, r.hash, seg.clone(), plan.text.clone())),
    )
    .await?;
    widen(&mut plan, query.fuzzy, &opened, &texts).await?;
    complete(&mut plan, &opened, &texts).await?;
    let plan = Arc::new(plan);
    let newest = tail.newest();
    let mut shadow: Vec<u64> = newest.keys().map(|id| key(id)).collect();
    shadow.sort_unstable();
    let live = tail.live(&newest);
    let tail_side = TailSide::new(&plan, &tail, &texts, &live, query)?;

    let mut reads: Vec<BoxFuture<'_, Result<()>>> = Vec::new();
    for opened in &opened {
        reads.extend(warm(opened, &plan, query));
    }
    let dead = try_join_all(parts.iter().map(|p| part::dead(storage, p)));
    let hidden =
        try_join_all((opened.iter()).map(|opened| part::find(storage, &opened.ids, &shadow)));
    let mut wanted = Vec::new();
    if let Some(filter) = &query.filter {
        id_keys(filter, &mut wanted);
    }
    let by_id =
        try_join_all((opened.iter()).map(|opened| part::find(storage, &opened.ids, &wanted)));
    let ((), dead, hidden, by_id) = futures::try_join!(
        try_join_all(reads).map(|done| done.map(drop)),
        dead,
        hidden,
        by_id
    )?;

    let scored = {
        let plan = plan.clone();
        let opened = opened.clone();
        let filter = query.filter.clone();
        let top_k = query.top_k;
        blocking(move || -> Result<Top> {
            let stats = statistics(&plan, &opened, &tail_side.stats)?;
            let mut top = Top::new(top_k);
            tail_side.score(&plan, &stats, &mut top);
            for (p, opened) in opened.iter().enumerate() {
                let hidden: HashSet<u32> = hidden[p].values().copied().collect();
                let dead = dead[p].as_deref().map(Vec::as_slice);
                let filtered = filter_bits(&plan, opened, filter.as_ref(), &by_id[p])?;
                let allowed = |doc: u32| {
                    !dead.is_some_and(|bits| part::is_set(bits, doc))
                        && !hidden.contains(&doc)
                        && filtered.as_ref().is_none_or(|bits| part::is_set(bits, doc))
                };
                let weight = plan
                    .query(fields_of(opened))
                    .weight(EnableScoring::enabled_from_statistics_provider(
                        &stats,
                        &opened.searcher,
                    ))
                    .map_err(engine)?;
                let reader = single(opened)?;
                weight
                    .for_each_pruning(top.threshold(), reader, &mut |doc, score| {
                        if allowed(doc) {
                            top.offer(score, Source::Part(p, doc));
                        }
                        top.threshold()
                    })
                    .map_err(engine)?;
            }
            Ok(top)
        })
        .await??
    };

    let found = scored.sorted();
    let docs = try_join_all(found.iter().map(|(_, source)| async {
        match *source {
            Source::Tail(segment, row) => {
                let segment = &tail.segments[segment].1;
                Ok((segment.ids[row].clone(), segment.attributes[row].clone()))
            }
            Source::Part(p, doc) => {
                let address = DocAddress::new(0, doc);
                let stored: TantivyDocument =
                    (opened[p].searcher.doc_async(address).await).map_err(engine)?;
                part::stored(&stored, &plan.fields)
            }
        }
    }))
    .await?;
    let mut hits: Vec<TextHit> = (found.into_iter().zip(docs))
        .map(|((score, _), (id, attributes))| plan.hit(query, id, score, attributes))
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    Ok(hits)
}

const MAX_EDITS: u8 = 2;

async fn widen(
    plan: &mut Plan,
    edits: u8,
    opened: &[Arc<Opened>],
    texts: &[Arc<TailText>],
) -> Result<()> {
    if edits == 0 {
        return Ok(());
    }
    if edits > MAX_EDITS {
        return Err(invalid(format!("fuzzy takes 0 to {MAX_EDITS} edits")));
    }
    let mut seen: HashSet<(usize, String)> =
        (plan.clauses.iter()).map(|c| (c.0, c.2.clone())).collect();
    let mut more = Vec::new();
    for (f, field, word, boost) in plan.clauses.clone() {
        let near = Near::new(field, &word, edits)?;
        let found = try_join_all(opened.iter().map(|opened| near.words(opened, field))).await?;
        let mut words: BTreeSet<String> = found.into_iter().flatten().collect();
        for text in texts {
            words.extend(text.terms().iter().filter(|w| near.matches(w)).cloned());
        }
        for word in words {
            if seen.insert((f, word.clone())) {
                more.push((f, field, word, boost));
            }
        }
    }
    plan.clauses.extend(more);
    Ok(())
}

/// Adds the words each last-word prefix stands for.
async fn complete(plan: &mut Plan, opened: &[Arc<Opened>], texts: &[Arc<TailText>]) -> Result<()> {
    for (f, field, prefix, boost) in std::mem::take(&mut plan.prefixes) {
        let near = Near::Prefix(prefix.as_bytes().into());
        let found = try_join_all(opened.iter().map(|opened| near.words(opened, field))).await?;
        let mut words: BTreeSet<String> = found.into_iter().flatten().collect();
        for text in texts {
            words.extend(
                text.terms()
                    .iter()
                    .filter(|w| w.starts_with(&prefix))
                    .cloned(),
            );
        }
        if words.len() > MAX_EXPANSIONS {
            return Err(invalid(format!(
                "the prefix `{prefix}` stands for more than {MAX_EXPANSIONS} words; make it longer"
            )));
        }
        plan.clauses
            .extend(words.into_iter().map(|word| (f, field, word, boost)));
    }
    Ok(())
}

#[derive(Clone)]
enum Near {
    Edits(Arc<DfaWrapper>),
    Prefix(Arc<[u8]>),
}

const DEAD: u32 = u32::MAX;

impl Near {
    fn new(field: Field, word: &str, edits: u8) -> Result<Self> {
        let query = FuzzyTermQuery::new(Term::from_field_text(field, word), edits, true);
        Ok(Self::Edits(Arc::new(query.automaton().map_err(engine)?)))
    }

    fn matches(&self, word: &str) -> bool {
        let mut state = self.start();
        for byte in word.bytes() {
            if !self.can_match(&state) {
                return false;
            }
            state = self.accept(&state, byte);
        }
        self.is_match(&state)
    }

    async fn words(&self, opened: &Opened, field: Field) -> Result<Vec<String>> {
        if (field.field_id() as usize) >= fields_of(opened) {
            return Ok(Vec::new());
        }
        let inverted = single(opened)?.inverted_index(field).map_err(engine)?;
        let spawn = |task: Box<dyn FnOnce() -> std::io::Result<()> + Send>| async move {
            tokio::task::spawn_blocking(task)
                .await
                .map_err(std::io::Error::other)?
        };
        (inverted.warm_postings_automaton(self.clone(), spawn).await).map_err(engine)?;
        let mut stream = (inverted.terms().search(self.clone()).into_stream()).map_err(engine)?;
        let mut words = Vec::new();
        while stream.advance() {
            if let Ok(word) = std::str::from_utf8(stream.key()) {
                words.push(word.to_string());
            }
        }
        Ok(words)
    }
}

impl Automaton for Near {
    type State = u32;

    fn start(&self) -> u32 {
        match self {
            Self::Edits(dfa) => dfa.start(),
            Self::Prefix(_) => 0,
        }
    }

    fn is_match(&self, state: &u32) -> bool {
        match self {
            Self::Edits(dfa) => dfa.is_match(state),
            Self::Prefix(prefix) => *state != DEAD && *state as usize >= prefix.len(),
        }
    }

    fn can_match(&self, state: &u32) -> bool {
        match self {
            Self::Edits(dfa) => dfa.can_match(state),
            Self::Prefix(_) => *state != DEAD,
        }
    }

    fn accept(&self, state: &u32, byte: u8) -> u32 {
        match self {
            Self::Edits(dfa) => dfa.accept(state, byte),
            Self::Prefix(prefix) => match prefix.get(*state as usize) {
                _ if *state == DEAD => DEAD,
                None => *state,
                Some(&want) if want == byte => state + 1,
                Some(_) => DEAD,
            },
        }
    }
}

struct Plan {
    fields: Arc<Fields>,
    text: Arc<Vec<(String, TextOptions)>>,
    clauses: Clauses,
    prefixes: Clauses,
    conditions: Vec<Condition>,
    k1: f32,
    b: f32,
}

struct Condition {
    f: usize,
    how: How,
    words: Vec<String>,
    prefix: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum How {
    Phrase,
    All,
    Any,
}

impl Condition {
    fn new(f: usize, options: &TextOptions, found: &Match) -> Result<Self> {
        let mut analyzer = analyzer(options);
        let (how, text) = match found {
            Match::Phrase(_, text) | Match::Prefix(_, text) => (How::Phrase, text),
            Match::AllTokens(_, text) => (How::All, text),
            Match::AnyToken(_, text) => (How::Any, text),
        };
        if let Match::Prefix(name, _) = found {
            let (words, prefix) = prefix_parts(options, text);
            let prefix =
                prefix.ok_or_else(|| invalid(format!("the prefix of `{name}` has no word")))?;
            return Ok(Self {
                f,
                how,
                words,
                prefix: Some(prefix),
            });
        }
        Ok(Self {
            f,
            how,
            words: tokens(&mut analyzer, text),
            prefix: None,
        })
    }

    fn positions(&self) -> bool {
        self.how == How::Phrase && self.words.len() + self.prefix.is_some() as usize > 1
    }
}

impl Plan {
    fn new(schema: &Schema, base: Option<&Tantivy>, query: &TextQuery) -> Result<Self> {
        if schema.text.is_empty() {
            return Err(invalid("the index has no text attributes"));
        }
        let fields = Arc::new(Fields::new(schema, base));
        let text: Vec<(String, TextOptions)> =
            (schema.text.iter()).map(|(n, &o)| (n.clone(), o)).collect();
        let names: Vec<String> = text.iter().map(|(name, _)| name.clone()).collect();
        let asked: Vec<(String, f32)> = match query.fields.is_empty() {
            true => names.iter().map(|name| (name.clone(), 1.0)).collect(),
            false => query.fields.clone(),
        };
        let mut clauses = Vec::new();
        let mut prefixes = Vec::new();
        for (name, boost) in &asked {
            let f = text_field(&names, name)?;
            if !boost.is_finite() || *boost <= 0.0 {
                return Err(invalid(format!(
                    "the boost of `{name}` must be more than 0"
                )));
            }
            let field = fields.text[name];
            if query.last_as_prefix {
                let (words, prefix) = prefix_parts(&text[f].1, &query.query);
                clauses.extend(words.into_iter().map(|word| (f, field, word, *boost)));
                prefixes.extend(prefix.map(|prefix| (f, field, prefix, *boost)));
                continue;
            }
            for word in &tokens(&mut analyzer(&text[f].1), &query.query) {
                clauses.push((f, field, word.clone(), *boost));
            }
        }
        let defaults = schema.text[&asked[0].0];
        let (k1, b) = (
            query.k1.unwrap_or(defaults.k1),
            query.b.unwrap_or(defaults.b),
        );
        if !k1.is_finite() || k1 < 0.0 {
            return Err(invalid("k1 must be 0 or more"));
        }
        if !(0.0..=1.0).contains(&b) {
            return Err(invalid("b must be from 0 to 1"));
        }
        for name in query.include.iter() {
            if !schema.attributes.contains_key(name) {
                return Err(invalid(format!("no attribute `{name}`")));
            }
        }
        for name in &query.highlight {
            text_field(&names, name)?;
        }
        let conditions = (query.matches.iter())
            .map(|found| {
                let f = text_field(&names, found.name())?;
                Condition::new(f, &text[f].1, found)
            })
            .collect::<Result<_>>()?;
        if let Some(filter) = &query.filter {
            check_filter(schema, filter)?;
        }
        Ok(Self {
            fields,
            text: Arc::new(text),
            clauses,
            prefixes,
            conditions,
            k1,
            b,
        })
    }

    fn query(&self, count: usize) -> BooleanQuery {
        let clauses = (self.clauses.iter())
            .filter(|(_, field, ..)| (field.field_id() as usize) < count)
            .map(|(_, field, token, boost)| {
                let term = Term::from_field_text(*field, token);
                let query = Box::new(TermQuery::new(term, IndexRecordOption::WithFreqs));
                let query: Box<dyn tantivy::query::Query> = match *boost == 1.0 {
                    true => query,
                    false => Box::new(BoostQuery::new(query, *boost)),
                };
                (Occur::Should, query)
            })
            .collect();
        BooleanQuery::new(clauses)
    }

    fn hit(&self, query: &TextQuery, id: Id, score: f32, attributes: Attributes) -> TextHit {
        let mut highlights = BTreeMap::new();
        for name in &query.highlight {
            let Some(Value::String(text)) = attributes.get(name) else {
                continue;
            };
            let Some(f) = self.text.iter().position(|(n, _)| n == name) else {
                continue;
            };
            let mut terms: HashSet<String> = (self.clauses.iter())
                .filter(|c| c.0 == f)
                .map(|(_, _, token, _)| token.clone())
                .collect();
            let mut prefixes = Vec::new();
            for condition in self.conditions.iter().filter(|c| c.f == f) {
                terms.extend(condition.words.iter().cloned());
                prefixes.extend(condition.prefix.clone());
            }
            let options = &self.text[f].1;
            highlights.insert(name.clone(), highlight(text, options, &terms, &prefixes));
        }
        let attributes = (attributes.into_iter())
            .filter(|(name, _)| query.include.contains(name))
            .collect();
        TextHit {
            id,
            score,
            attributes,
            highlights,
        }
    }
}

fn text_field(names: &[String], name: &str) -> Result<usize> {
    (names.iter().position(|n| n == name))
        .ok_or_else(|| invalid(format!("`{name}` is not a text attribute")))
}

fn check_filter(schema: &Schema, filter: &Filter) -> Result<()> {
    match filter {
        Filter::And(all) | Filter::Or(all) => all.iter().try_for_each(|f| check_filter(schema, f)),
        Filter::Not(inner) => check_filter(schema, inner),
        Filter::Eq(name, value)
        | Filter::Lt(name, value)
        | Filter::Lte(name, value)
        | Filter::Gt(name, value)
        | Filter::Gte(name, value) => check_value(schema, name, value),
        Filter::In(name, values) | Filter::ContainsAll(name, values) => {
            values.iter().try_for_each(|v| check_value(schema, name, v))
        }
        Filter::Matches(name, _) if schema.text.get(name).is_some_and(|o| !o.filterable) => {
            Err(invalid(format!(
                "`{name}` is text: filter it with `phrase` or `prefix`"
            )))
        }
        Filter::Exists(name) if !schema.attributes.contains_key(name) => {
            Err(invalid(format!("no attribute `{name}`")))
        }
        Filter::Matches(..) | Filter::Ids(_) | Filter::IdRange(..) | Filter::Exists(_) => Ok(()),
    }
}

fn check_value(schema: &Schema, name: &str, value: &Value) -> Result<()> {
    if schema
        .text
        .get(name)
        .is_some_and(|options| !options.filterable)
    {
        return Err(invalid(format!(
            "`{name}` is text: filter it with `phrase` or `prefix`"
        )));
    }
    match (schema.attributes.get(name), value) {
        (None, _) => Err(invalid(format!("no attribute `{name}`"))),
        (Some(Kind::Strings), Value::Strings(_)) => Err(invalid(format!(
            "`{name}` is a list: compare it with one string"
        ))),
        _ => Ok(()),
    }
}

fn prefix_parts(options: &TextOptions, phrase: &str) -> (Vec<String>, Option<String>) {
    let mut analyzer = analyzer(options);
    let mut plain = prefix_analyzer(options);
    let mut stream = plain.token_stream(phrase);
    let mut last = None;
    while stream.advance() {
        let token = stream.token();
        last = Some((token.offset_from, token.text.clone()));
    }
    match last {
        Some((start, prefix)) => (tokens(&mut analyzer, &phrase[..start]), Some(prefix)),
        None => (Vec::new(), None),
    }
}

#[derive(Default)]
struct Counts {
    docs: u64,
    tokens: HashMap<usize, u64>,
    df: HashMap<(usize, String), u64>,
}

struct Stats {
    docs: u64,
    tokens: HashMap<Field, u64>,
    df: HashMap<Term, u64>,
    k1: f32,
    b: f32,
}

impl Bm25StatisticsProvider for Stats {
    fn total_num_tokens(&self, field: Field) -> tantivy::Result<u64> {
        Ok(self.tokens.get(&field).copied().unwrap_or(0).max(1))
    }

    fn total_num_docs(&self) -> tantivy::Result<u64> {
        Ok(self.docs.max(1))
    }

    fn doc_freq(&self, term: &Term) -> tantivy::Result<u64> {
        Ok(self.df.get(term).copied().unwrap_or(0))
    }

    fn bm25_params(&self) -> (Score, Score) {
        (self.k1, self.b)
    }
}

fn statistics(plan: &Plan, opened: &[Arc<Opened>], tail: &Counts) -> Result<Stats> {
    let mut stats = Stats {
        docs: tail.docs,
        tokens: HashMap::new(),
        df: HashMap::new(),
        k1: plan.k1,
        b: plan.b,
    };
    for (f, field, token, _) in &plan.clauses {
        let term = Term::from_field_text(*field, token);
        let tail_df = tail.df.get(&(*f, token.clone())).copied().unwrap_or(0);
        stats.df.insert(term, tail_df);
        let tail_tokens = tail.tokens.get(f).copied().unwrap_or(0);
        stats.tokens.insert(*field, tail_tokens);
    }
    for opened in opened {
        let has = |field: Field| (field.field_id() as usize) < fields_of(opened);
        for reader in opened.searcher.segment_readers() {
            stats.docs += reader.max_doc() as u64;
            let fields: HashSet<Field> = stats.tokens.keys().copied().filter(|&f| has(f)).collect();
            for field in fields {
                let inverted = reader.inverted_index(field).map_err(engine)?;
                *stats.tokens.entry(field).or_default() += inverted.total_num_tokens();
            }
            for (term, df) in stats.df.iter_mut().filter(|(term, _)| has(term.field())) {
                let inverted = reader.inverted_index(term.field()).map_err(engine)?;
                *df += inverted.doc_freq(term).map_err(engine)? as u64;
            }
        }
    }
    Ok(stats)
}

struct TailSide {
    rows: Vec<(usize, usize, Arc<TailText>)>,
    stats: Counts,
}

impl TailSide {
    fn new(
        plan: &Plan,
        tail: &Tail,
        texts: &[Arc<TailText>],
        live: &[(&Id, Row)],
        query: &TextQuery,
    ) -> Result<Self> {
        let mut side = TailSide {
            rows: Vec::new(),
            stats: Counts::default(),
        };
        let fields: HashSet<usize> = plan.clauses.iter().map(|c| c.0).collect();
        for &(id, row) in live {
            let text = &texts[row.segment];
            side.stats.docs += 1;
            for &f in &fields {
                let Some(tokens) = text.tokens(row.row, f) else {
                    continue;
                };
                *side.stats.tokens.entry(f).or_default() += tokens.len() as u64;
                let present: HashSet<u32> = tokens.iter().copied().collect();
                let words: HashSet<&String> = (plan.clauses.iter())
                    .filter(|c| c.0 == f)
                    .map(|c| &c.2)
                    .collect();
                for word in words {
                    if text.term(word).is_some_and(|n| present.contains(&n)) {
                        *side.stats.df.entry((f, word.clone())).or_default() += 1;
                    }
                }
            }
            let attributes = &tail.segment(row).attributes[row.row];
            let passes = query
                .filter
                .as_ref()
                .is_none_or(|f| f.matches(id, attributes))
                && (plan.conditions.iter()).all(|c| tail_matches(text, row.row, c));
            if passes {
                side.rows.push((row.segment, row.row, text.clone()));
            }
        }
        Ok(side)
    }

    fn score(&self, plan: &Plan, stats: &Stats, top: &mut Top) {
        let weights: Vec<Bm25Weight> = (plan.clauses.iter())
            .map(|(_, field, token, boost)| {
                let term = Term::from_field_text(*field, token);
                Bm25Weight::for_terms(stats, &[term])
                    .map(|weight| weight.boost_by(*boost))
                    .expect("statistics in memory")
            })
            .collect();
        for (segment, row, text) in &self.rows {
            let mut score = 0.0;
            let mut matched = false;
            for ((f, _, token, _), weight) in plan.clauses.iter().zip(&weights) {
                let (Some(tokens), Some(n)) = (text.tokens(*row, *f), text.term(token)) else {
                    continue;
                };
                let tf = tokens.iter().filter(|&&t| t == n).count() as u32;
                if tf > 0 {
                    let norm =
                        tantivy::fieldnorm::FieldNormReader::fieldnorm_to_id(tokens.len() as u32);
                    score += weight.score(norm, tf);
                    matched = true;
                }
            }
            if matched {
                top.offer(score, Source::Tail(*segment, *row));
            }
        }
    }
}

fn tail_matches(text: &TailText, row: usize, condition: &Condition) -> bool {
    let Some(tokens) = text.tokens(row, condition.f) else {
        return false;
    };
    let mut terms = condition.words.iter().map(|w| text.term(w));
    let has = |term: Option<u32>| term.is_some_and(|n| tokens.contains(&n));
    match condition.how {
        How::All => !condition.words.is_empty() && terms.all(has),
        How::Any => terms.any(has),
        How::Phrase => {
            let Some(phrase) = terms.collect::<Option<Vec<u32>>>() else {
                return false;
            };
            match &condition.prefix {
                Some(prefix) => holds(tokens, &phrase, Some(&text.starting(prefix))),
                None => holds(tokens, &phrase, None),
            }
        }
    }
}

fn warm<'a>(
    opened: &'a Opened,
    plan: &'a Plan,
    query: &'a TextQuery,
) -> Vec<BoxFuture<'a, Result<()>>> {
    let mut reads: Vec<BoxFuture<'a, Result<()>>> = Vec::new();
    let Ok(reader) = single(opened) else {
        return reads;
    };
    let mut terms: HashSet<(Term, bool)> = HashSet::new();
    let mut ranges: Vec<Range> = Vec::new();
    let mut norms: HashSet<Field> = HashSet::new();
    let fields = plan.fields.within(fields_of(opened));
    let clauses =
        (plan.clauses.iter()).filter(|(f, ..)| fields.text.contains_key(&plan.text[*f].0));
    for (_, field, token, _) in clauses {
        terms.insert((Term::from_field_text(*field, token), false));
        norms.insert(*field);
    }
    for condition in &plan.conditions {
        let Some(&field) = fields.text.get(&plan.text[condition.f].0) else {
            continue;
        };
        let positions = condition.positions();
        for word in &condition.words {
            terms.insert((Term::from_field_text(field, word), positions));
        }
        if let Some(prefix) = &condition.prefix {
            let (low, high) = prefix_range(field, prefix);
            ranges.push((field, low, high, positions, Some(MAX_EXPANSIONS as u64)));
        }
    }
    if let Some(filter) = &query.filter {
        filter_reads(&fields, filter, &mut terms, &mut ranges);
    }
    for (term, positions) in terms {
        let Ok(inverted) = reader.inverted_index(term.field()) else {
            continue;
        };
        reads.push(
            async move {
                inverted
                    .warm_postings(&term, positions)
                    .await
                    .map_err(engine)?;
                Ok(())
            }
            .boxed(),
        );
    }
    for (field, low, high, positions, limit) in ranges {
        let Ok(inverted) = reader.inverted_index(field) else {
            continue;
        };
        reads.push(
            async move {
                let range = (low, high);
                (inverted.warm_postings_range(range, limit, positions).await).map_err(engine)?;
                Ok(())
            }
            .boxed(),
        );
    }
    for field in norms {
        let file = reader
            .fieldnorms_readers()
            .get_inner_file()
            .open_read(field);
        if let Some(file) = file {
            reads.push(
                async move { file.read_bytes_async().await.map(drop).map_err(engine) }.boxed(),
            );
        }
    }
    reads
}

type Range = (Field, Bound<Term>, Bound<Term>, bool, Option<u64>);

fn filter_reads(
    fields: &Fields,
    filter: &Filter,
    terms: &mut HashSet<(Term, bool)>,
    ranges: &mut Vec<Range>,
) {
    match filter {
        Filter::And(all) | Filter::Or(all) => all
            .iter()
            .for_each(|f| filter_reads(fields, f, terms, ranges)),
        Filter::Not(inner) => filter_reads(fields, inner, terms, ranges),
        Filter::Eq(name, value) => terms.extend(term_of(fields, name, value).map(|t| (t, false))),
        Filter::In(name, values) | Filter::ContainsAll(name, values) => terms.extend(
            values
                .iter()
                .filter_map(|v| term_of(fields, name, v))
                .map(|t| (t, false)),
        ),
        Filter::Lt(..) | Filter::Lte(..) | Filter::Gt(..) | Filter::Gte(..) => {
            if let Some((field, low, high)) = range_of(fields, filter) {
                let limit = Some(MAX_EXPANSIONS as u64);
                ranges.push((field, low, high, false, limit));
            }
        }
        Filter::Ids(_) | Filter::IdRange(..) => {}
        Filter::Matches(name, _) | Filter::Exists(name) => {
            if let Some(field) = present_field(fields, name) {
                ranges.push((field, Bound::Unbounded, Bound::Unbounded, false, None));
            }
        }
    }
}

fn term_of(fields: &Fields, name: &str, value: &Value) -> Option<Term> {
    let &(field, kind) = fields.attributes.get(name)?;
    match (kind.item(), value) {
        (Kind::String, Value::String(text)) => Some(Term::from_field_text(field, text)),
        (Kind::Uuid, Value::Uuid(u)) => Some(Term::from_field_text(field, &uuid_text(*u))),
        (Kind::Number, Value::Number(n)) => Some(Term::from_field_f64(field, *n)),
        (Kind::Int, Value::Int(n)) | (Kind::Datetime, Value::Datetime(n)) => {
            Some(Term::from_field_i64(field, *n))
        }
        (Kind::Bool, Value::Bool(b)) => Some(Term::from_field_bool(field, *b)),
        _ => None,
    }
}

fn range_of(fields: &Fields, filter: &Filter) -> Option<(Field, Bound<Term>, Bound<Term>)> {
    let (name, value) = match filter {
        Filter::Lt(n, v) | Filter::Lte(n, v) | Filter::Gt(n, v) | Filter::Gte(n, v) => (n, v),
        _ => return None,
    };
    let &(field, kind) = fields.attributes.get(name)?;
    let up = matches!(filter, Filter::Gt(..) | Filter::Gte(..));
    let term = match (kind.item(), value) {
        (Kind::String, Value::String(text)) => Term::from_field_text(field, text),
        (Kind::Uuid, Value::Uuid(u)) => Term::from_field_text(field, &uuid_text(*u)),
        (Kind::Number, Value::Number(n)) if !n.is_nan() => Term::from_field_f64(field, *n),
        (Kind::Int, Value::Int(n)) | (Kind::Datetime, Value::Datetime(n)) => {
            Term::from_field_i64(field, *n)
        }
        (Kind::Int, Value::Number(n)) if n.is_finite() => {
            let whole = if up { n.ceil() } else { n.floor() };
            let term = Term::from_field_i64(field, whole as i64);
            if n.fract() != 0.0 {
                let bound = match up {
                    true => (Bound::Included(term), Bound::Unbounded),
                    false => (Bound::Unbounded, Bound::Included(term)),
                };
                return Some((field, bound.0, bound.1));
            }
            term
        }
        _ => return None,
    };
    let (low, high) = match filter {
        Filter::Lt(..) => (Bound::Unbounded, Bound::Excluded(term)),
        Filter::Lte(..) => (Bound::Unbounded, Bound::Included(term)),
        Filter::Gt(..) => (Bound::Excluded(term), Bound::Unbounded),
        _ => (Bound::Included(term), Bound::Unbounded),
    };
    Some((field, low, high))
}

fn prefix_range(field: Field, prefix: &str) -> (Bound<Term>, Bound<Term>) {
    let low = Bound::Included(Term::from_field_text(field, prefix));
    let mut end = prefix.as_bytes().to_vec();
    while end.last() == Some(&u8::MAX) {
        end.pop();
    }
    let high = match end.last_mut() {
        Some(last) => {
            *last += 1;
            Bound::Excluded(Term::from_field_bytes(field, &end))
        }
        None => Bound::Unbounded,
    };
    (low, high)
}

type Boxed = Box<dyn tantivy::query::Query>;

fn present_field(fields: &Fields, name: &str) -> Option<Field> {
    (fields.attributes.get(name).map(|&(field, _)| field))
        .or_else(|| fields.text.get(name).copied())
}

/// The documents with any value in `field`.
fn present(reader: &tantivy::SegmentReader, field: Field) -> Result<Vec<u32>> {
    let inverted = reader.inverted_index(field).map_err(engine)?;
    let mut stream = inverted.terms().stream().map_err(engine)?;
    let mut docs = tantivy::BitSet::with_max_value(reader.max_doc());
    while stream.advance() {
        let mut postings = (inverted
            .read_postings_from_terminfo(stream.value(), IndexRecordOption::Basic))
        .map_err(engine)?;
        while postings.doc() != TERMINATED {
            docs.insert(postings.doc());
            postings.advance();
        }
    }
    Ok((0..reader.max_doc())
        .filter(|&doc| docs.contains(doc))
        .collect())
}

fn filter_query(
    fields: &Fields,
    reader: &tantivy::SegmentReader,
    filter: &Filter,
    docs: &BTreeMap<u64, u32>,
) -> Result<Boxed> {
    let all = |list: Vec<(Occur, Boxed)>| -> Boxed { Box::new(BooleanQuery::new(list)) };
    let each = |occur: Occur, filters: &mut dyn Iterator<Item = Filter>| -> Result<Boxed> {
        let list = filters.map(|f| Ok((occur, filter_query(fields, reader, &f, docs)?)));
        Ok(all(list.collect::<Result<_>>()?))
    };
    let eq = |name: &String, values: &[Value]| -> Vec<Filter> {
        values
            .iter()
            .map(|v| Filter::Eq(name.clone(), v.clone()))
            .collect()
    };
    Ok(match filter {
        Filter::And(list) if list.is_empty() => Box::new(AllQuery),
        Filter::And(list) => each(Occur::Must, &mut list.iter().cloned())?,
        Filter::Or(list) if list.is_empty() => Box::new(EmptyQuery),
        Filter::Or(list) => each(Occur::Should, &mut list.iter().cloned())?,
        Filter::Not(inner) => all(vec![
            (Occur::Must, Box::new(AllQuery)),
            (Occur::MustNot, filter_query(fields, reader, inner, docs)?),
        ]),
        Filter::Eq(name, value) => match term_of(fields, name, value) {
            Some(term) => Box::new(TermQuery::new(term, IndexRecordOption::Basic)),
            None => Box::new(EmptyQuery),
        },
        Filter::In(name, values) => each(Occur::Should, &mut eq(name, values).into_iter())?,
        Filter::Ids(ids) => {
            let found = (ids.iter()).filter_map(|id| docs.get(&key(id)).copied());
            Box::new(Docs(found.collect()))
        }
        Filter::IdRange(..) => {
            let store = reader.get_store_reader(64).map_err(engine)?;
            let mut found = Vec::new();
            for doc in 0..reader.max_doc() {
                let stored: TantivyDocument = store.get(doc).map_err(engine)?;
                let (id, attributes) = part::stored(&stored, fields)?;
                if filter.matches(&id, &attributes) {
                    found.push(doc);
                }
            }
            Box::new(Docs(found))
        }
        Filter::Exists(name) => match present_field(fields, name) {
            Some(field) => Box::new(Docs(present(reader, field)?)),
            None => Box::new(EmptyQuery),
        },
        Filter::ContainsAll(name, values) => each(Occur::Must, &mut eq(name, values).into_iter())?,
        Filter::Lt(..) | Filter::Lte(..) | Filter::Gt(..) | Filter::Gte(..) => {
            match range_of(fields, filter) {
                Some((_, low, high)) => Box::new(RangeQuery::new(low, high)),
                None => Box::new(EmptyQuery),
            }
        }
        Filter::Matches(name, pattern) => match fields.attributes.get(name) {
            Some(&(field, _)) => {
                let inverted = reader.inverted_index(field).map_err(engine)?;
                let mut stream = inverted.terms().stream().map_err(engine)?;
                let mut terms = Vec::new();
                while stream.advance() {
                    if let Ok(text) = std::str::from_utf8(stream.key())
                        && pattern.is_match(text)
                    {
                        terms.push(Term::from_field_text(field, text));
                    }
                }
                Box::new(TermSetQuery::new(terms))
            }
            None => Box::new(EmptyQuery),
        },
    })
}

fn match_query(
    plan: &Plan,
    fields: &Fields,
    opened: &Opened,
    condition: &Condition,
) -> Result<Box<dyn tantivy::query::Query>> {
    let name = &plan.text[condition.f].0;
    let Some(&field) = fields.text.get(name) else {
        return Ok(Box::new(EmptyQuery));
    };
    let mut words: Vec<Term> = (condition.words.iter())
        .map(|w| Term::from_field_text(field, w))
        .collect();
    let one = |term: Term| -> Box<dyn tantivy::query::Query> {
        Box::new(TermQuery::new(term, IndexRecordOption::Basic))
    };
    let each = |occur: Occur, words: Vec<Term>| -> Box<dyn tantivy::query::Query> {
        Box::new(BooleanQuery::new(
            words.into_iter().map(|term| (occur, one(term))).collect(),
        ))
    };
    Ok(match (condition.how, &condition.prefix) {
        (_, None) if words.is_empty() => Box::new(EmptyQuery),
        (How::All, _) => each(Occur::Must, words),
        (How::Any, _) => each(Occur::Should, words),
        (How::Phrase, None) if words.len() == 1 => one(words.remove(0)),
        (How::Phrase, None) => Box::new(PhraseQuery::new(words)),
        (How::Phrase, Some(prefix)) => {
            let (low, high) = prefix_range(field, prefix);
            let inverted = single(opened)?.inverted_index(field).map_err(engine)?;
            let mut stream = (inverted.terms().range()).ge(bound_bytes(&low).unwrap_or_default());
            if let Some(high) = bound_bytes(&high) {
                stream = stream.lt(high);
            }
            let mut stream = stream.into_stream().map_err(engine)?;
            let mut count = 0;
            while stream.advance() {
                count += 1;
                if count > MAX_EXPANSIONS {
                    return Err(invalid(format!(
                        "the prefix `{prefix}` of `{name}` stands for more than {MAX_EXPANSIONS} words; make it longer"
                    )));
                }
            }
            words.push(Term::from_field_text(field, prefix));
            let mut query = PhrasePrefixQuery::new(words);
            query.set_max_expansions(MAX_EXPANSIONS as u32);
            Box::new(query)
        }
    })
}

fn bound_bytes(bound: &Bound<Term>) -> Option<Vec<u8>> {
    match bound {
        Bound::Included(term) | Bound::Excluded(term) => {
            Some(term.serialized_value_bytes().to_vec())
        }
        Bound::Unbounded => None,
    }
}

fn filter_bits(
    plan: &Plan,
    opened: &Opened,
    filter: Option<&Filter>,
    docs: &BTreeMap<u64, u32>,
) -> Result<Option<Vec<u8>>> {
    let fields = plan.fields.within(fields_of(opened));
    let mut clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = Vec::new();
    if let Some(filter) = filter {
        let query = filter_query(&fields, single(opened)?, filter, docs)?;
        clauses.push((Occur::Must, query));
    }
    for condition in &plan.conditions {
        clauses.push((Occur::Must, match_query(plan, &fields, opened, condition)?));
    }
    if clauses.is_empty() {
        return Ok(None);
    }
    let query = BooleanQuery::new(clauses);
    let weight = query
        .weight(EnableScoring::disabled_from_searcher(&opened.searcher))
        .map_err(engine)?;
    let reader = single(opened)?;
    let mut bits = vec![0u8; reader.max_doc().div_ceil(8) as usize];
    let mut scorer = weight.scorer(reader, 1.0).map_err(engine)?;
    let mut doc = scorer.doc();
    while doc != TERMINATED {
        part::set(&mut bits, doc);
        doc = scorer.advance();
    }
    Ok(Some(bits))
}

fn fields_of(opened: &Opened) -> usize {
    opened.searcher.schema().num_fields()
}

#[derive(Clone, Debug)]
struct Docs(Vec<u32>);

impl tantivy::query::Query for Docs {
    fn weight(&self, _: EnableScoring<'_>) -> tantivy::Result<Box<dyn Weight>> {
        Ok(Box::new(self.clone()))
    }
}

impl Weight for Docs {
    fn scorer(
        &self,
        reader: &tantivy::SegmentReader,
        boost: Score,
    ) -> tantivy::Result<Box<dyn tantivy::query::Scorer>> {
        let mut docs = tantivy::BitSet::with_max_value(reader.max_doc());
        for &doc in &self.0 {
            docs.insert(doc);
        }
        Ok(Box::new(ConstScorer::new(BitSetDocSet::from(docs), boost)))
    }

    fn explain(
        &self,
        _: &tantivy::SegmentReader,
        _: tantivy::DocId,
    ) -> tantivy::Result<tantivy::query::Explanation> {
        Ok(tantivy::query::Explanation::new("by id", 1.0))
    }
}

fn id_keys(filter: &Filter, out: &mut Vec<u64>) {
    match filter {
        Filter::Ids(ids) => out.extend(ids.iter().map(key)),
        Filter::And(all) | Filter::Or(all) => all.iter().for_each(|f| id_keys(f, out)),
        Filter::Not(inner) => id_keys(inner, out),
        _ => {}
    }
}

fn single(opened: &Opened) -> Result<&tantivy::SegmentReader> {
    match opened.searcher.segment_readers() {
        [reader] => Ok(reader),
        _ => Err(Error::Corrupt(
            "a text part has more than one segment".into(),
        )),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Source {
    Tail(usize, usize),
    Part(usize, u32),
}

struct Entry(f32, Source);

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Entry {}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0).then(other.1.cmp(&self.1))
    }
}

struct Top {
    k: usize,
    heap: BinaryHeap<Reverse<Entry>>,
}

impl Top {
    fn new(k: usize) -> Self {
        Self {
            k,
            heap: BinaryHeap::with_capacity(k + 1),
        }
    }

    fn threshold(&self) -> f32 {
        match self.heap.len() < self.k {
            true => f32::MIN,
            false => self.heap.peek().map_or(f32::MIN, |worst| worst.0.0),
        }
    }

    fn offer(&mut self, score: f32, source: Source) {
        if self.heap.len() < self.k {
            self.heap.push(Reverse(Entry(score, source)));
        } else if score > self.threshold() {
            self.heap.pop();
            self.heap.push(Reverse(Entry(score, source)));
        }
    }

    fn sorted(self) -> Vec<(f32, Source)> {
        let mut all: Vec<Entry> = self.heap.into_iter().map(|e| e.0).collect();
        all.sort_by(|a, b| b.cmp(a));
        all.into_iter().map(|e| (e.0, e.1)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_keeps_the_best_k() {
        let mut top = Top::new(2);
        assert_eq!(top.threshold(), f32::MIN);
        top.offer(1.0, Source::Tail(0, 0));
        top.offer(3.0, Source::Tail(0, 1));
        top.offer(2.0, Source::Part(0, 5));
        assert_eq!(top.threshold(), 2.0);
        let sorted: Vec<f32> = top.sorted().into_iter().map(|e| e.0).collect();
        assert_eq!(sorted, [3.0, 2.0]);
    }

    #[test]
    fn prefixes_bound_the_terms_after_them() {
        let field = Field::from_field_id(0);
        let (low, high) = prefix_range(field, "pas");
        assert_eq!(bound_bytes(&low).unwrap(), b"pas");
        assert_eq!(bound_bytes(&high).unwrap(), b"pat");
    }
}
