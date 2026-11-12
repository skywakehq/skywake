//! How a Skywake schema maps to a Tantivy schema, and the analyzers.

use std::collections::BTreeMap;

use tantivy::schema::{
    FAST, Field, INDEXED, IndexRecordOption, STORED, STRING, Schema as Tantivy, TextFieldIndexing,
    TextOptions as FieldOptions,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, Language as Stems, LowerCaser, RawTokenizer, RemoveLongFilter,
    SimpleTokenizer, Stemmer, StopWordFilter, TextAnalyzer, Token, TokenFilter, TokenStream,
    Tokenizer,
};

use super::{Language, TextOptions};
use crate::{Id, Kind, Schema};

const ANALYZER: &str = "skywake_en_1";

const LANGUAGES: [Language; 19] = [
    Language::English,
    Language::Arabic,
    Language::Danish,
    Language::Dutch,
    Language::Finnish,
    Language::French,
    Language::German,
    Language::Greek,
    Language::Hungarian,
    Language::Italian,
    Language::Norwegian,
    Language::Portuguese,
    Language::Romanian,
    Language::Russian,
    Language::Spanish,
    Language::Swedish,
    Language::Tamil,
    Language::Turkish,
    Language::None,
];

impl Language {
    fn stems(self) -> Option<Stems> {
        Some(match self {
            Language::English => Stems::English,
            Language::Arabic => Stems::Arabic,
            Language::Danish => Stems::Danish,
            Language::Dutch => Stems::Dutch,
            Language::Finnish => Stems::Finnish,
            Language::French => Stems::French,
            Language::German => Stems::German,
            Language::Greek => Stems::Greek,
            Language::Hungarian => Stems::Hungarian,
            Language::Italian => Stems::Italian,
            Language::Norwegian => Stems::Norwegian,
            Language::Portuguese => Stems::Portuguese,
            Language::Romanian => Stems::Romanian,
            Language::Russian => Stems::Russian,
            Language::Spanish => Stems::Spanish,
            Language::Swedish => Stems::Swedish,
            Language::Tamil => Stems::Tamil,
            Language::Turkish => Stems::Turkish,
            Language::None => return None,
        })
    }

    pub fn name(self) -> String {
        format!("{self:?}").to_lowercase()
    }

    pub(crate) fn stopwords(self) -> Option<StopWordFilter> {
        StopWordFilter::new(self.stems()?)
    }
}

/// The options that change how text is split into words, by name. Names
/// made before the later options keep their old form.
pub(crate) fn analyzer_name(options: &TextOptions) -> String {
    let default = TextOptions::default();
    let mut flags = String::new();
    if !options.stemming {
        flags.push_str("_nostem");
    }
    if options.case_sensitive {
        flags.push_str("_case");
    }
    if options.ascii_folding {
        flags.push_str("_fold");
    }
    if options.max_token != default.max_token {
        flags.push_str(&format!("_max{}", options.max_token));
    }
    if options.pre_tokenized {
        flags.push_str("_raw");
    }
    let stop = if options.stopwords { "_stop" } else { "" };
    match (options.language, options.stopwords, flags.is_empty()) {
        (Language::English, false, true) => ANALYZER.to_string(),
        (language, _, true) => format!("skywake_{}{stop}_1", language.name()),
        (language, ..) => format!("skywake_{}{stop}{flags}_2", language.name()),
    }
}

/// The options an analyzer's name stands for.
fn options_named(name: &str) -> Option<TextOptions> {
    if name == ANALYZER {
        return Some(TextOptions::default());
    }
    let inner = name.strip_prefix("skywake_")?;
    let inner = (inner.strip_suffix("_1")).or_else(|| inner.strip_suffix("_2"))?;
    let mut parts = inner.split('_');
    let language = parts.next()?;
    let mut options = TextOptions {
        language: *LANGUAGES.iter().find(|l| l.name() == language)?,
        ..TextOptions::default()
    };
    for flag in parts {
        match flag {
            "stop" => options.stopwords = true,
            "nostem" => options.stemming = false,
            "case" => options.case_sensitive = true,
            "fold" => options.ascii_folding = true,
            "raw" => options.pre_tokenized = true,
            max => options.max_token = max.strip_prefix("max")?.parse().ok()?,
        }
    }
    Some(options)
}

pub(crate) fn analyzer(options: &TextOptions) -> TextAnalyzer {
    if options.pre_tokenized {
        return TextAnalyzer::builder(RawTokenizer::default()).build();
    }
    let mut start = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(options.max_token as usize + 1))
        .dynamic();
    if !options.case_sensitive {
        start = start.filter_dynamic(LowerCaser);
    }
    if options.ascii_folding {
        start = start.filter_dynamic(AsciiFoldingFilter);
    }
    let stems = (options.language.stems())
        .filter(|_| options.stemming)
        .map(Stemmer::new);
    if let Some(stop) = (options.language.stopwords()).filter(|_| options.stopwords) {
        start = start.filter_dynamic(stop).filter_dynamic(Renumber);
    }
    if let Some(stems) = stems {
        start = start.filter_dynamic(stems);
    }
    start.build()
}

/// Splits like `analyzer` but keeps each word whole, for matching a prefix.
pub(crate) fn prefix_analyzer(options: &TextOptions) -> TextAnalyzer {
    let plain = TextOptions {
        stemming: false,
        stopwords: false,
        ..*options
    };
    analyzer(&plain)
}

pub(crate) fn register(index: &tantivy::Index) {
    let names: Vec<String> = (index.schema().fields())
        .filter_map(|(_, entry)| match entry.field_type() {
            tantivy::schema::FieldType::Str(text) => text.get_indexing_options(),
            _ => None,
        })
        .map(|indexing| indexing.tokenizer().to_string())
        .collect();
    for name in names {
        if let Some(options) = options_named(&name) {
            index.tokenizers().register(&name, analyzer(&options));
        }
    }
}

#[derive(Clone)]
struct Renumber;

impl TokenFilter for Renumber {
    type Tokenizer<T: Tokenizer> = Renumbered<T>;

    fn transform<T: Tokenizer>(self, tokenizer: T) -> Renumbered<T> {
        Renumbered(tokenizer)
    }
}

#[derive(Clone)]
struct Renumbered<T>(T);

impl<T: Tokenizer> Tokenizer for Renumbered<T> {
    type TokenStream<'a> = RenumberedStream<T::TokenStream<'a>>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        RenumberedStream {
            inner: self.0.token_stream(text),
            next: 0,
        }
    }
}

struct RenumberedStream<S> {
    inner: S,
    next: usize,
}

impl<S: TokenStream> TokenStream for RenumberedStream<S> {
    fn advance(&mut self) -> bool {
        if !self.inner.advance() {
            return false;
        }
        self.inner.token_mut().position = self.next;
        self.next += 1;
        true
    }

    fn token(&self) -> &Token {
        self.inner.token()
    }

    fn token_mut(&mut self) -> &mut Token {
        self.inner.token_mut()
    }
}

pub(crate) fn tokens(analyzer: &mut TextAnalyzer, text: &str) -> Vec<String> {
    let mut stream = analyzer.token_stream(text);
    let mut tokens = Vec::new();
    while stream.advance() {
        tokens.push(stream.token().text.clone());
    }
    tokens
}

pub(crate) struct Fields {
    pub schema: Tantivy,
    pub doc: Field,
    pub key: Field,
    pub text: BTreeMap<String, Field>,
    pub attributes: BTreeMap<String, (Field, Kind)>,
}

impl Fields {
    pub(crate) fn new(schema: &Schema, base: Option<&Tantivy>) -> Self {
        let mut builder = Tantivy::builder();
        match base {
            Some(base) => base.fields().for_each(|(_, entry)| {
                builder.add_field(entry.clone());
            }),
            None => {
                builder.add_bytes_field("doc", STORED);
                builder.add_u64_field("key", FAST);
            }
        }
        let has = |name: &str| base.is_some_and(|base| base.get_field(name).is_ok());
        for (name, options) in &schema.text {
            let name = format!("t_{name}");
            if !has(&name) {
                let indexing = TextFieldIndexing::default()
                    .set_tokenizer(&analyzer_name(options))
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions);
                let options = FieldOptions::default().set_indexing_options(indexing);
                builder.add_text_field(&name, options);
            }
        }
        for (name, &kind) in &schema.attributes {
            let name = format!("a_{name}");
            let text = schema.text.get(&name[2..]);
            if text.is_some_and(|options| !options.filterable) || has(&name) {
                continue;
            }
            match kind {
                Kind::String | Kind::Strings | Kind::Uuid => builder.add_text_field(&name, STRING),
                Kind::Number | Kind::Numbers => builder.add_f64_field(&name, INDEXED),
                Kind::Int | Kind::Ints | Kind::Datetime => builder.add_i64_field(&name, INDEXED),
                Kind::Bool => builder.add_bool_field(&name, INDEXED),
                Kind::Sparse | Kind::Vectors => continue,
            };
        }
        let tantivy = builder.build();
        let field = |name: String| tantivy.get_field(&name).expect("a field just added");
        let text = (schema.text.keys())
            .map(|name| (name.clone(), field(format!("t_{name}"))))
            .collect();
        let unfiltered = |name: &String| schema.text.get(name).is_some_and(|o| !o.filterable);
        let attributes = (schema.attributes.iter())
            .filter(|(name, kind)| !unfiltered(name) && !scored(**kind))
            .map(|(name, &kind)| (name.clone(), (field(format!("a_{name}")), kind)))
            .collect();
        Self {
            doc: field("doc".into()),
            key: field("key".into()),
            schema: tantivy,
            text,
            attributes,
        }
    }

    pub(crate) fn within(&self, count: usize) -> Self {
        let has = |field: &Field| (field.field_id() as usize) < count;
        Self {
            schema: self.schema.clone(),
            doc: self.doc,
            key: self.key,
            text: (self.text.iter())
                .filter(|(_, field)| has(field))
                .map(|(name, &field)| (name.clone(), field))
                .collect(),
            attributes: (self.attributes.iter())
                .filter(|(_, (field, _))| has(field))
                .map(|(name, &found)| (name.clone(), found))
                .collect(),
        }
    }
}

fn scored(kind: Kind) -> bool {
    matches!(kind, Kind::Sparse | Kind::Vectors)
}

pub(crate) fn key(id: &Id) -> u64 {
    let bytes = postcard::to_stdvec(id).unwrap_or_default();
    let hash = blake3::hash(&bytes);
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_stems_lowercases_and_keeps_stopwords() {
        let mut analyzer = analyzer(&TextOptions::default());
        assert_eq!(
            tokens(&mut analyzer, "To be, or NOT to be: Running dogs!"),
            ["to", "be", "or", "not", "to", "be", "run", "dog"]
        );
        let long = "x".repeat(41);
        assert_eq!(tokens(&mut analyzer, &format!("a {long} b")), ["a", "b"]);
    }

    #[test]
    fn languages_stem_and_stopwords_drop_with_no_gaps() {
        let french = TextOptions {
            language: Language::French,
            stopwords: true,
            ..TextOptions::default()
        };
        let mut stems = analyzer(&french);
        assert_eq!(
            tokens(&mut stems, "Les chevaux et les maisons"),
            ["cheval", "maison"]
        );
        let mut stream = stems.token_stream("le cheval de la maison");
        let mut positions = Vec::new();
        while stream.advance() {
            positions.push(stream.token().position);
        }
        assert_eq!(positions, [0, 1]);
        let plain = TextOptions {
            language: Language::None,
            ..TextOptions::default()
        };
        assert_eq!(
            tokens(&mut analyzer(&plain), "Running dogs"),
            ["running", "dogs"]
        );
        assert_eq!(analyzer_name(&TextOptions::default()), "skywake_en_1");
        assert_eq!(analyzer_name(&french), "skywake_french_stop_1");
        assert!(Language::Arabic.stopwords().is_none());
    }

    #[test]
    fn keys_differ_by_kind_of_id() {
        assert_ne!(key(&Id::Num(1)), key(&Id::Str("1".into())));
        assert_eq!(key(&Id::Num(7)), key(&Id::Num(7)));
    }
}
