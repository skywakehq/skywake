//! `skywake index`: search indexes through the API.

mod filter;
mod flags;
mod rows;
mod show;
mod table;
mod upsert;

use std::io::IsTerminal;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use clap::{Args, Subcommand};
use reqwest::Method;
use serde_json::{Value, json};

use crate::api::{Api, segment};
use flags::{attribute_column, doc_id, vector_column};
use rows::{Columns, Format};
use show::{attribute_summary, print_stats, vector_summary};
use upsert::upsert;

const BATCH_MAX: usize = 1000;

#[derive(Args)]
pub(crate) struct IndexArgs {
    /// The API.
    #[arg(
        long,
        env = "SKYWAKE_URL",
        default_value = "http://localhost:8080",
        global = true
    )]
    url: String,

    /// An API key (`sw_...`), made in the console.
    #[arg(long, env = "SKYWAKE_KEY", hide_env_values = true, global = true)]
    key: Option<String>,

    /// Print the API's JSON instead of a table, for scripts.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: IndexCommand,
}

#[derive(Subcommand)]
enum IndexCommand {
    /// List the indexes you can reach.
    List,
    /// Make an index with an empty `main` branch. Its columns can't change
    /// later.
    #[command(after_help = "Examples:\n  \
        skywake index create prod/products --vector embedding:768 --attr tag:string --attr price:number\n  \
        skywake index create prod/products --schema schema.json")]
    Create {
        /// Such as `prod/products`. The part before `/` is the environment.
        name: String,
        /// A vector column, as NAME:DIMS or NAME:DIMS:METRIC. METRIC is
        /// cosine (the default), euclidean or dot.
        #[arg(
            long = "vector",
            value_name = "NAME:DIMS[:METRIC]",
            required_unless_present = "schema"
        )]
        vectors: Vec<String>,
        /// An attribute, as NAME:TYPE. TYPE is string, number, bool or
        /// strings (a list of strings).
        #[arg(long = "attr", value_name = "NAME:TYPE")]
        attributes: Vec<String>,
        /// The schema as a JSON file: {"vectors": [..], "attributes": [..]}.
        #[arg(long, conflicts_with_all = ["vectors", "attributes"])]
        schema: Option<PathBuf>,
        /// Where the index keeps its data; the default region if not given. Can't change later.
        #[arg(long)]
        region: Option<String>,
    },
    /// Show an index's columns, and the counts of its `main` branch.
    Get { name: String },
    /// Show the counts of one branch.
    Stats {
        name: String,
        #[arg(short, long, default_value = "main")]
        branch: String,
    },
    /// Delete an index, every branch and all its data.
    Delete {
        name: String,
        /// Delete without asking. Needed when not at a terminal.
        #[arg(short, long)]
        yes: bool,
    },
    /// Write documents from JSON lines, CSV or Parquet, in batches. Each
    /// replaces any earlier one with its id, so running it again is safe.
    #[command(after_help = "A row has `id`, then each column by name:\n  \
        {\"id\": 1, \"embedding\": [0.1, 0.2], \"tag\": \"billing\"}\n\
        The API's own shape works too: {\"id\", \"vectors\": {..}, \"attributes\": {..}}.\n\
        In CSV, write a vector as a JSON list (\"[0.1, 0.2]\"), a list of strings as a|b,\n\
        and leave a cell empty to leave the attribute out. Ids of only digits are numbers.")]
    Upsert {
        name: String,
        /// The file. Without it, or with `-`, stdin.
        file: Option<PathBuf>,
        #[arg(short, long, default_value = "main")]
        branch: String,
        /// Default: from the file's extension (.csv, .parquet), else JSON lines.
        #[arg(long, value_enum)]
        format: Option<Format>,
        /// Documents in one request.
        #[arg(long, default_value_t = BATCH_MAX as u16, value_parser = clap::value_parser!(u16).range(1..=BATCH_MAX as i64))]
        batch_size: u16,
    },
    /// Delete documents by id. Ids that are not there are ignored.
    DeleteDocs {
        name: String,
        /// Ids of only digits are taken as numbers.
        #[arg(required = true)]
        ids: Vec<String>,
        #[arg(short, long, default_value = "main")]
        branch: String,
    },
    /// Find the documents nearest to a vector, nearest first.
    #[command(after_help = "Filters:\n  \
        tag = billing and price < 10\n  \
        (tag = a or tag = b) and not live = false\n  \
        tag in (a, b, 'c d')    tag not in (x)    tag != x\n\
        Operators: = != < <= > >= in. A value is a number, true, false, a word or a quoted string.\n\
        JSON in the API's form works too: '{\"price\": {\"lt\": 10}}'.")]
    Query {
        name: String,
        /// The vector, as a JSON list.
        #[arg(
            long,
            required_unless_present = "vector_file",
            allow_hyphen_values = true
        )]
        vector: Option<String>,
        /// A file holding the vector as a JSON list; `-` for stdin.
        #[arg(long, conflicts_with = "vector")]
        vector_file: Option<PathBuf>,
        /// The vector column. Needed only when the index has more than one.
        #[arg(long)]
        column: Option<String>,
        /// Which documents may match, such as `tag = billing and price < 10`.
        #[arg(short, long)]
        filter: Option<String>,
        #[arg(short = 'k', long, default_value_t = 10)]
        top_k: u32,
        /// Attributes to show with each hit, comma separated; `*` for all.
        #[arg(short, long, value_delimiter = ',')]
        include: Vec<String>,
        /// Clusters to read. More is slower and finds more of the true
        /// nearest. The server picks one by default.
        #[arg(long)]
        probe: Option<u32>,
        #[arg(short, long, default_value = "main")]
        branch: String,
    },
    /// Fork a branch. Nothing is copied; each then sees only its own writes.
    Fork {
        name: String,
        /// The new branch.
        branch: String,
        /// The branch to fork.
        #[arg(long, default_value = "main")]
        from: String,
    },
    /// List an index's branches.
    Branches { name: String },
    /// Delete a branch. `main` stays while the index does.
    DeleteBranch { name: String, branch: String },
    /// Start clustering a branch's rows, so queries read less. It answers
    /// once the build has started; `stats` shows when it is done.
    Build {
        name: String,
        #[arg(short, long, default_value = "main")]
        branch: String,
    },
}

pub(crate) async fn run(args: IndexArgs) -> Result<()> {
    let api = Api::new(&args.url, args.key.filter(|key| !key.is_empty()))?;
    let json = args.json;
    let show = |value: &Value| {
        println!(
            "{}",
            serde_json::to_string_pretty(value).unwrap_or_default()
        )
    };
    match args.command {
        IndexCommand::List => {
            let indexes = every(&api, "/indexes").await?;
            if json {
                show(&Value::Array(indexes));
                return Ok(());
            }
            if indexes.is_empty() {
                println!("no indexes yet; make one with `skywake index create`");
                return Ok(());
            }
            let rows: Vec<Vec<String>> = indexes
                .iter()
                .map(|index| {
                    vec![
                        table::cell(&index["name"]),
                        table::cell(&index["region"]),
                        vector_summary(&index["schema"]),
                        attribute_summary(&index["schema"]),
                        table::time(&index["created"]),
                    ]
                })
                .collect();
            table::print(
                &["NAME", "REGION", "VECTORS", "ATTRIBUTES", "CREATED"],
                &rows,
            );
        }
        IndexCommand::Create {
            name,
            vectors,
            attributes,
            schema,
            region,
        } => {
            let schema = match schema {
                Some(path) => {
                    let text = std::fs::read_to_string(&path)
                        .with_context(|| format!("can't read {}", path.display()))?;
                    serde_json::from_str(&text)
                        .with_context(|| format!("{} is not JSON", path.display()))?
                }
                None => json!({
                    "vectors": vectors.iter().map(|v| vector_column(v)).collect::<Result<Vec<_>>>()?,
                    "attributes": attributes.iter().map(|a| attribute_column(a)).collect::<Result<Vec<_>>>()?,
                }),
            };
            let mut body = json!({ "name": name, "schema": schema });
            if let Some(region) = region {
                body["region"] = json!(region);
            }
            let made = api
                .call(Method::POST, "/indexes", Some(&body), false)
                .await?;
            match json {
                true => show(&made),
                false => println!(
                    "created {name} in {}, with an empty `main` branch",
                    table::cell(&made["region"])
                ),
            }
        }
        IndexCommand::Get { name } => {
            let index = api.get(&format!("/indexes/{}", segment(&name))).await?;
            if json {
                show(&index);
                return Ok(());
            }
            println!(
                "{}  (region {}, created {})",
                name,
                table::cell(&index["region"]),
                table::time(&index["created"])
            );
            println!();
            let mut rows = Vec::new();
            for column in index["schema"]["vectors"].as_array().into_iter().flatten() {
                rows.push(vec![
                    table::cell(&column["name"]),
                    format!("vector[{}]", column["dims"]),
                    table::cell(&column["metric"]),
                ]);
            }
            for column in index["schema"]["attributes"]
                .as_array()
                .into_iter()
                .flatten()
            {
                rows.push(vec![
                    table::cell(&column["name"]),
                    table::cell(&column["type"]),
                    String::new(),
                ]);
            }
            table::print(&["COLUMN", "TYPE", "METRIC"], &rows);
            println!();
            print_stats("main", &index["stats"]);
        }
        IndexCommand::Stats { name, branch } => {
            let path = format!("/indexes/{}/branches/{}", segment(&name), segment(&branch));
            let found = api.get(&path).await?;
            match json {
                true => show(&found),
                false => print_stats(&branch, &found["stats"]),
            }
        }
        IndexCommand::Delete { name, yes } => {
            if !yes {
                confirm(&format!("Delete {name}, every branch and all its data?"))?;
            }
            api.call(
                Method::DELETE,
                &format!("/indexes/{}", segment(&name)),
                None,
                true,
            )
            .await?;
            match json {
                true => show(&json!({ "deleted": name })),
                false => println!("deleted {name}"),
            }
        }
        IndexCommand::Upsert {
            name,
            file,
            branch,
            format,
            batch_size,
        } => {
            let file = file.filter(|path| path.as_os_str() != "-");
            let format = format.unwrap_or_else(|| Format::guess(file.as_deref()));
            let index = api.get(&format!("/indexes/{}", segment(&name))).await?;
            let columns = Columns::of(&index["schema"]);
            let rows = rows::read(file.as_deref(), format)?;
            let path = format!(
                "/indexes/{}/branches/{}/documents",
                segment(&name),
                segment(&branch)
            );
            let count = upsert(&api, &path, rows, &columns, batch_size.into()).await?;
            match json {
                true => show(&json!({ "count": count })),
                false => println!("wrote {count} documents to {name}:{branch}"),
            }
        }
        IndexCommand::DeleteDocs { name, ids, branch } => {
            let ids: Vec<Value> = ids.into_iter().map(doc_id).collect();
            let path = format!(
                "/indexes/{}/branches/{}/documents/delete",
                segment(&name),
                segment(&branch)
            );
            let mut count = 0;
            for chunk in ids.chunks(BATCH_MAX) {
                let body = json!({ "ids": chunk });
                count += api.call(Method::POST, &path, Some(&body), true).await?["count"]
                    .as_u64()
                    .unwrap_or(0);
            }
            match json {
                true => show(&json!({ "count": count })),
                false => println!("deleted {count} ids from {name}:{branch}"),
            }
        }
        IndexCommand::Query {
            name,
            vector,
            vector_file,
            column,
            filter,
            top_k,
            include,
            probe,
            branch,
        } => {
            let text = match (vector, vector_file) {
                (Some(text), _) => text,
                (None, Some(path)) if path.as_os_str() == "-" => {
                    std::io::read_to_string(std::io::stdin())?
                }
                (None, Some(path)) => std::fs::read_to_string(&path)
                    .with_context(|| format!("can't read {}", path.display()))?,
                (None, None) => bail!("give --vector or --vector-file"),
            };
            let value = rows::vector(
                "--vector",
                serde_json::from_str(text.trim()).map_err(|_| {
                    anyhow!("--vector must be a JSON list of numbers, such as [0.1, 0.2]")
                })?,
            )?;
            let wants_all = include.iter().any(|name| name == "*");
            let (column, include) = match (column, wants_all) {
                (Some(column), false) => (column, include),
                (column, _) => {
                    let index = api.get(&format!("/indexes/{}", segment(&name))).await?;
                    let columns = Columns::of(&index["schema"]);
                    let column = match (column, columns.vectors.as_slice()) {
                        (Some(column), _) => column,
                        (None, [only]) => only.clone(),
                        (None, many) => bail!(
                            "{name} has {} vector columns ({}); pick one with --column",
                            many.len(),
                            many.join(", ")
                        ),
                    };
                    let include = match wants_all {
                        true => columns
                            .attributes
                            .into_iter()
                            .map(|(name, _)| name)
                            .collect(),
                        false => include,
                    };
                    (column, include)
                }
            };
            let mut body = json!({
                "vector": { "column": column, "value": value },
                "topK": top_k,
            });
            if let Some(filter) = filter {
                body["filter"] = filter::parse(&filter)?;
            }
            if !include.is_empty() {
                body["include"] = json!(include);
            }
            if let Some(probe) = probe {
                body["probe"] = json!(probe);
            }
            let path = format!(
                "/indexes/{}/branches/{}/query",
                segment(&name),
                segment(&branch)
            );
            let answer = api.call(Method::POST, &path, Some(&body), true).await?;
            if json {
                show(&answer);
                return Ok(());
            }
            let hits = answer["hits"].as_array().cloned().unwrap_or_default();
            if hits.is_empty() {
                println!("no documents match");
                return Ok(());
            }
            let mut header = vec!["ID", "DISTANCE"];
            header.extend(include.iter().map(String::as_str));
            let rows: Vec<Vec<String>> = hits
                .iter()
                .map(|hit| {
                    let mut row = vec![
                        table::cell(&hit["id"]),
                        format!("{:.4}", hit["distance"].as_f64().unwrap_or(f64::NAN)),
                    ];
                    row.extend(
                        include
                            .iter()
                            .map(|name| table::cell(&hit["attributes"][name])),
                    );
                    row
                })
                .collect();
            table::print(&header, &rows);
        }
        IndexCommand::Fork { name, branch, from } => {
            let body = json!({ "name": branch, "from": from });
            let path = format!("/indexes/{}/branches", segment(&name));
            let made = api.call(Method::POST, &path, Some(&body), false).await?;
            match json {
                true => show(&made),
                false => println!("forked {name}:{from} as {branch}"),
            }
        }
        IndexCommand::Branches { name } => {
            let branches = every(&api, &format!("/indexes/{}/branches", segment(&name))).await?;
            if json {
                show(&Value::Array(branches));
                return Ok(());
            }
            let rows: Vec<Vec<String>> = branches
                .iter()
                .map(|branch| {
                    vec![
                        table::cell(&branch["name"]),
                        match branch["forked_from"].as_str() {
                            Some(from) => from.to_string(),
                            None => "-".to_string(),
                        },
                        table::time(&branch["created"]),
                    ]
                })
                .collect();
            table::print(&["BRANCH", "FORKED FROM", "CREATED"], &rows);
        }
        IndexCommand::DeleteBranch { name, branch } => {
            let path = format!("/indexes/{}/branches/{}", segment(&name), segment(&branch));
            api.call(Method::DELETE, &path, None, true).await?;
            match json {
                true => show(&json!({ "deleted": branch })),
                false => println!("deleted {name}:{branch}"),
            }
        }
        IndexCommand::Build { name, branch } => {
            let path = format!(
                "/indexes/{}/branches/{}/build",
                segment(&name),
                segment(&branch)
            );
            let operation = api.call(Method::POST, &path, None, true).await?;
            match json {
                true => show(&operation),
                false => println!(
                    "building {name}:{branch} as {}; `skywake index stats {name} -b {branch}` shows when it is done",
                    operation["id"].as_str().unwrap_or("an operation")
                ),
            }
        }
    }
    Ok(())
}

async fn every(api: &Api, path: &str) -> Result<Vec<Value>> {
    const PAGE: usize = 1000;
    let mut all: Vec<Value> = Vec::new();
    loop {
        let after = match all.last() {
            Some(last) => format!(
                "&after={}",
                segment(last["name"].as_str().unwrap_or_default())
            ),
            None => String::new(),
        };
        let page = api.get(&format!("{path}?limit={PAGE}{after}")).await?;
        let items = page.as_array().cloned().unwrap_or_default();
        let done = items.len() < PAGE;
        all.extend(items);
        if done {
            return Ok(all);
        }
    }
}

fn confirm(question: &str) -> Result<()> {
    if !std::io::stdin().is_terminal() {
        bail!("{question} Pass --yes to confirm");
    }
    eprint!("{question} Type yes: ");
    let mut answer = String::new();
    std::io::stdin().read_line(&mut answer)?;
    match answer.trim() {
        "yes" | "y" => Ok(()),
        _ => bail!("nothing was deleted"),
    }
}
