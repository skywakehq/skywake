//! Documents as a Parquet file.

use std::sync::Arc;

use parquet::basic::{Compression, LogicalType, Repetition, TimeUnit, Type as Physical};
use parquet::data_type::{
    BoolType, ByteArray, ByteArrayType, DoubleType, FixedLenByteArray, FixedLenByteArrayType,
    FloatType, Int64Type,
};
use parquet::errors::ParquetError;
use parquet::file::properties::WriterProperties;
use parquet::file::writer::SerializedFileWriter;
use parquet::schema::types::Type;

use crate::{Doc, Kind, Result, Schema, ShardsExport, Value};

const GROUP_ROWS: usize = 4096;

#[derive(Clone, Copy)]
enum Leaf {
    Text,
    Double,
    Float,
    Bool,
    Int,
    Uuid,
    Millis,
}

enum Item {
    Text(ByteArray),
    Double(f64),
    Float(f32),
    Bool(bool),
    Int(i64),
    Uuid(FixedLenByteArray),
}

struct Field {
    name: Option<String>,
    leaf: Leaf,
    list: bool,
}

impl Field {
    fn of(name: &str, kind: Kind) -> Self {
        let (leaf, list) = match kind {
            Kind::String | Kind::Sparse | Kind::Vectors => (Leaf::Text, false),
            Kind::Number => (Leaf::Double, false),
            Kind::Bool => (Leaf::Bool, false),
            Kind::Int => (Leaf::Int, false),
            Kind::Uuid => (Leaf::Uuid, false),
            Kind::Datetime => (Leaf::Millis, false),
            Kind::Strings => (Leaf::Text, true),
            Kind::Ints => (Leaf::Int, true),
            Kind::Numbers => (Leaf::Double, true),
        };
        Field {
            name: Some(name.to_string()),
            leaf,
            list,
        }
    }

    fn column(&self) -> Result<Type> {
        let (physical, logical) = match self.leaf {
            Leaf::Text => (Physical::BYTE_ARRAY, Some(LogicalType::String)),
            Leaf::Double => (Physical::DOUBLE, None),
            Leaf::Float => (Physical::FLOAT, None),
            Leaf::Bool => (Physical::BOOLEAN, None),
            Leaf::Int => (Physical::INT64, None),
            Leaf::Uuid => (Physical::FIXED_LEN_BYTE_ARRAY, Some(LogicalType::Uuid)),
            Leaf::Millis => (
                Physical::INT64,
                Some(LogicalType::timestamp(true, TimeUnit::MILLIS)),
            ),
        };
        let Some(name) = &self.name else {
            let id = Type::primitive_type_builder("id", physical);
            return Ok(id
                .with_repetition(Repetition::REQUIRED)
                .with_logical_type(logical)
                .build()?);
        };
        let leaf = |name: &str, repetition| {
            let leaf = Type::primitive_type_builder(name, physical)
                .with_repetition(repetition)
                .with_logical_type(logical.clone());
            match self.leaf {
                Leaf::Uuid => leaf.with_length(16).build(),
                _ => leaf.build(),
            }
        };
        if !self.list {
            return Ok(leaf(name, Repetition::OPTIONAL)?);
        }
        let list = Type::group_type_builder("list")
            .with_repetition(Repetition::REPEATED)
            .with_fields(vec![Arc::new(leaf("element", Repetition::REQUIRED)?)])
            .build()?;
        Ok(Type::group_type_builder(name)
            .with_repetition(Repetition::OPTIONAL)
            .with_logical_type(Some(LogicalType::List))
            .with_fields(vec![Arc::new(list)])
            .build()?)
    }
}

#[derive(Default)]
struct Buffer {
    items: Vec<Item>,
    defined: Vec<i16>,
    repeated: Vec<i16>,
}

impl Buffer {
    fn push(&mut self, field: &Field, items: Option<Vec<Item>>) {
        match (field.list, items) {
            (_, None) => {
                self.defined.push(0);
                self.repeated.push(0);
            }
            (false, Some(items)) => {
                self.defined.push(1);
                self.repeated.push(0);
                self.items.extend(items);
            }
            (true, Some(items)) if items.is_empty() => {
                self.defined.push(1);
                self.repeated.push(0);
            }
            (true, Some(items)) => {
                for i in 0..items.len() {
                    self.defined.push(2);
                    self.repeated.push(if i == 0 { 0 } else { 1 });
                }
                self.items.extend(items);
            }
        }
    }
}

pub struct ParquetExport {
    export: ShardsExport,
    fields: Vec<Field>,
    writer: Option<SerializedFileWriter<Vec<u8>>>,
    docs: Vec<Doc>,
}

impl ShardsExport {
    pub fn parquet(self, schema: &Schema) -> Result<ParquetExport> {
        let mut fields = vec![Field {
            name: None,
            leaf: Leaf::Text,
            list: false,
        }];
        fields.extend(schema.vectors.keys().map(|name| Field {
            name: Some(name.clone()),
            leaf: Leaf::Float,
            list: true,
        }));
        fields.extend((schema.attributes.iter()).map(|(name, kind)| Field::of(name, *kind)));
        let columns = fields.iter().map(|f| f.column().map(Arc::new));
        let root = Type::group_type_builder("document")
            .with_fields(columns.collect::<Result<_>>()?)
            .build()?;
        let properties = WriterProperties::builder()
            .set_compression(Compression::SNAPPY)
            .build();
        let writer = SerializedFileWriter::new(Vec::new(), Arc::new(root), Arc::new(properties))?;
        Ok(ParquetExport {
            export: self,
            fields,
            writer: Some(writer),
            docs: Vec::new(),
        })
    }
}

impl ParquetExport {
    pub async fn next(&mut self) -> Result<Option<Vec<u8>>> {
        while self.writer.is_some() {
            match self.export.next().await? {
                Some(docs) => {
                    self.docs.extend(docs);
                    if self.docs.len() >= GROUP_ROWS {
                        return self.group().map(Some);
                    }
                }
                None => {
                    let mut bytes = self.group()?;
                    let writer = self.writer.take().expect("checked above");
                    bytes.extend(writer.into_inner()?);
                    return Ok(Some(bytes));
                }
            }
        }
        Ok(None)
    }

    fn group(&mut self) -> Result<Vec<u8>> {
        let writer = self.writer.as_mut().expect("not finished");
        let docs = std::mem::take(&mut self.docs);
        if !docs.is_empty() {
            let mut group = writer.next_row_group()?;
            for field in &self.fields {
                let mut buffer = Buffer::default();
                for doc in &docs {
                    buffer.push(field, items(field, doc));
                }
                let mut column = group.next_column()?.expect("a column per field");
                write(&mut column, field, buffer)?;
                column.close()?;
            }
            group.close()?;
        }
        writer.flush().map_err(ParquetError::from)?;
        Ok(std::mem::take(writer.inner_mut()))
    }
}

fn items(field: &Field, doc: &Doc) -> Option<Vec<Item>> {
    let text = |text: String| Item::Text(ByteArray::from(text.into_bytes()));
    let Some(name) = &field.name else {
        return Some(vec![text(doc.id.to_string())]);
    };
    if let Leaf::Float = field.leaf {
        let vector = doc.vectors.get(name)?;
        return Some(vector.iter().map(|x| Item::Float(*x)).collect());
    }
    Some(match doc.attributes.get(name)? {
        Value::String(s) => vec![text(s.clone())],
        Value::Number(n) => vec![Item::Double(*n)],
        Value::Bool(b) => vec![Item::Bool(*b)],
        Value::Int(n) | Value::Datetime(n) => vec![Item::Int(*n)],
        Value::Uuid(uuid) => vec![Item::Uuid(uuid.to_be_bytes().to_vec().into())],
        Value::Strings(list) => list.iter().map(|s| text(s.clone())).collect(),
        Value::Ints(list) => list.iter().map(|n| Item::Int(*n)).collect(),
        Value::Numbers(list) => list.iter().map(|n| Item::Double(*n)).collect(),
        Value::Sparse(pairs) => {
            let (indices, values): (Vec<u32>, Vec<f32>) = pairs.iter().copied().unzip();
            vec![text(format!(
                r#"{{"indices":{},"values":{}}}"#,
                json(&indices),
                json(&values)
            ))]
        }
        Value::Vectors(list) => {
            let vectors: Vec<String> = list.iter().map(|v| json(v)).collect();
            vec![text(format!("[{}]", vectors.join(",")))]
        }
    })
}

fn json<T: ToString>(numbers: &[T]) -> String {
    let numbers: Vec<String> = numbers.iter().map(T::to_string).collect();
    format!("[{}]", numbers.join(","))
}

fn write(
    column: &mut parquet::file::writer::SerializedColumnWriter<'_>,
    field: &Field,
    buffer: Buffer,
) -> Result<()> {
    let (defined, repeated) = match field.name {
        None => (None, None),
        Some(_) => (Some(&buffer.defined[..]), Some(&buffer.repeated[..])),
    };
    let repeated = repeated.filter(|_| field.list);
    macro_rules! typed {
        ($type:ty, $item:ident) => {{
            let values: Vec<_> = (buffer.items.into_iter())
                .filter_map(|item| match item {
                    Item::$item(value) => Some(value),
                    _ => None,
                })
                .collect();
            column
                .typed::<$type>()
                .write_batch(&values, defined, repeated)?;
        }};
    }
    match field.leaf {
        Leaf::Text => typed!(ByteArrayType, Text),
        Leaf::Double => typed!(DoubleType, Double),
        Leaf::Float => typed!(FloatType, Float),
        Leaf::Bool => typed!(BoolType, Bool),
        Leaf::Int | Leaf::Millis => typed!(Int64Type, Int),
        Leaf::Uuid => typed!(FixedLenByteArrayType, Uuid),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use object_store::memory::InMemory;
    use parquet::file::reader::{FileReader, SerializedFileReader};
    use parquet::record::reader::RowIter;

    use crate::{Doc, Kind, Metric, Options, Schema, Shards, Value};

    #[tokio::test]
    async fn an_export_comes_out_as_parquet_with_a_column_per_field() {
        let schema = Schema::new()
            .vector("v", 2, Metric::Euclidean)
            .attribute("title", Kind::String)
            .attribute("n", Kind::Int)
            .attribute("tags", Kind::Strings)
            .attribute("at", Kind::Datetime)
            .attribute("sparse", Kind::Sparse);
        let stores = vec![Arc::new(InMemory::new()) as _];
        let index = Shards::create(stores, schema.clone(), Options::default())
            .await
            .unwrap();
        let docs = vec![
            Doc::new(1)
                .vector("v", vec![1.0, 0.5])
                .attribute("title", "one")
                .attribute("n", Value::Int(7))
                .attribute("tags", Value::Strings(vec!["a".into(), "b".into()]))
                .attribute("at", Value::Datetime(1_000))
                .attribute("sparse", Value::Sparse(vec![(3, 0.5)])),
            Doc::new("two").vector("v", vec![2.0, 1.0]),
        ];
        index.upsert(docs).await.unwrap();
        let mut export = index.export().await.unwrap().parquet(&schema).unwrap();
        let mut file = Vec::new();
        while let Some(bytes) = export.next().await.unwrap() {
            file.extend(bytes);
        }
        assert!(file.starts_with(b"PAR1") && file.ends_with(b"PAR1"));

        let reader = SerializedFileReader::new(bytes::Bytes::from(file)).unwrap();
        assert_eq!(reader.metadata().file_metadata().num_rows(), 2);
        let mut rows: Vec<String> = RowIter::from_file_into(Box::new(reader))
            .map(|row| row.unwrap().to_string())
            .collect();
        rows.sort();
        assert_eq!(
            rows,
            [
                r#"{id: "1", v: [1.0, 0.5], at: 1970-01-01 00:00:01.000 +00:00, n: 7, sparse: "{"indices":[3],"values":[0.5]}", tags: ["a", "b"], title: "one"}"#,
                r#"{id: "two", v: [2.0, 1.0], at: null, n: null, sparse: null, tags: null, title: null}"#,
            ]
        );
    }

    #[tokio::test]
    async fn a_large_export_comes_a_row_group_at_a_time() {
        let schema = Schema::new().vector("v", 1, Metric::Euclidean);
        let stores = vec![Arc::new(InMemory::new()) as _];
        let index = Shards::create(stores, schema.clone(), Options::default())
            .await
            .unwrap();
        let rows = super::GROUP_ROWS as u64;
        for part in [0..rows, rows..2 * rows] {
            let docs = part.map(|i| Doc::new(i).vector("v", vec![i as f32]));
            index.upsert(docs.collect()).await.unwrap();
        }
        let mut export = index.export().await.unwrap().parquet(&schema).unwrap();
        let mut parts = Vec::new();
        while let Some(bytes) = export.next().await.unwrap() {
            parts.push(bytes);
        }
        assert_eq!(parts.len(), 3);
        let reader = SerializedFileReader::new(bytes::Bytes::from(parts.concat())).unwrap();
        assert_eq!(reader.metadata().num_row_groups(), 2);
        assert_eq!(
            reader.metadata().file_metadata().num_rows(),
            2 * rows as i64
        );
    }
}
