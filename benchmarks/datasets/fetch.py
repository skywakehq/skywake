#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["h5py>=3.11", "numpy>=1.26", "pyarrow>=16"]
# ///
"""Downloads the public datasets the index benchmarks use and converts them: one folder per set, with a
dataset.json that says where it came from. Vector sets get base.fbin, query.fbin, groundtruth.ibin (top 100 ids per
query) and a `metric` file, for `index-bench run`; msmarco gets the passages, queries and judgments for
`index-bench msmarco`. Downloads and converted sets go to benchmarks/datasets/data/, which git ignores.

    benchmarks/datasets/fetch.py list
    benchmarks/datasets/fetch.py get sift-1m [--dir benchmarks/datasets/data]
    benchmarks/datasets/fetch.py self-test          converts tiny local files, no network

Sets, with what `get` downloads. The converted folder is about the same
size, and the download is deleted after converting.

    sift-1m      1M x 128, euclidean, 10k queries   525 MB
        http://ann-benchmarks.com/sift-128-euclidean.hdf5
    gist-1m      1M x 960, euclidean, 1k queries    3.8 GB
        http://ann-benchmarks.com/gist-960-euclidean.hdf5
    cohere-1m    1M x 768, cosine, 1k queries       3.1 GB  (Cohere embeddings of Wikipedia)
        https://assets.zilliz.com/benchmark/cohere_medium_1m/train.parquet      3.1 GB
        https://assets.zilliz.com/benchmark/cohere_medium_1m/test.parquet       3 MB
        https://assets.zilliz.com/benchmark/cohere_medium_1m/neighbors.parquet  4 MB
    openai-500k  500k x 1536, cosine, 1k queries    4.5 GB  (OpenAI embeddings of C4)
        https://assets.zilliz.com/benchmark/openai_medium_500k/train.parquet     4.5 GB
        https://assets.zilliz.com/benchmark/openai_medium_500k/test.parquet      7 MB
        https://assets.zilliz.com/benchmark/openai_medium_500k/neighbors.parquet 4 MB
    cohere-10m   10M x 768, cosine, 1k queries      31 GB   (the same, ten times larger)
        https://assets.zilliz.com/benchmark/cohere_large_10m/train-00-of-10.parquet  3.1 GB each, 00 to 09
        https://assets.zilliz.com/benchmark/cohere_large_10m/test.parquet            3 MB
        https://assets.zilliz.com/benchmark/cohere_large_10m/neighbors.parquet       39 MB

    msmarco      8.8M passages, 6,980 dev small and 43 judged DL19 queries   1.06 GB download, 2.9 GB unpacked
        https://msmarco.z22.web.core.windows.net/msmarcoranking/collectionandqueries.tar.gz
        https://msmarco.z22.web.core.windows.net/msmarcoranking/msmarco-test2019-queries.tsv.gz
        https://trec.nist.gov/data/deep/2019qrels-pass.txt

The two parquet sets are VectorDBBench's public ones. Sizes were checked
with HEAD requests on 2026-11-08.
"""

import argparse
import gzip
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import h5py
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

ANN = "http://ann-benchmarks.com"
ZILLIZ = "https://assets.zilliz.com/benchmark"
MSMARCO = "https://msmarco.z22.web.core.windows.net/msmarcoranking"
DATA = Path(__file__).resolve().parent / "data"

SETS = {
    "sift-1m": {"hdf5": f"{ANN}/sift-128-euclidean.hdf5"},
    "gist-1m": {"hdf5": f"{ANN}/gist-960-euclidean.hdf5"},
    "cohere-1m": {"parquet": f"{ZILLIZ}/cohere_medium_1m", "metric": "cosine"},
    "openai-500k": {"parquet": f"{ZILLIZ}/openai_medium_500k", "metric": "cosine"},
    "cohere-10m": {"parquet": f"{ZILLIZ}/cohere_large_10m", "metric": "cosine", "parts": 10},
    "msmarco": {
        "text": [
            f"{MSMARCO}/collectionandqueries.tar.gz",
            f"{MSMARCO}/msmarco-test2019-queries.tsv.gz",
            "https://trec.nist.gov/data/deep/2019qrels-pass.txt",
        ]
    },
}
MSMARCO_FILES = {"collection.tsv", "queries.dev.small.tsv", "qrels.dev.small.tsv"}

# Rows converted at a time, so no set is held in memory whole.
BLOCK = 100_000
DEPTH = 100


def write_header(file, rows, dims):
    np.array([rows, dims], dtype="<u4").tofile(file)


def convert_hdf5(path, out):
    """ann-benchmarks files: train, test and neighbors arrays."""
    out.mkdir(parents=True, exist_ok=True)
    with h5py.File(path, "r") as f:
        for name, target in (("train", "base.fbin"), ("test", "query.fbin")):
            data = f[name]
            with open(out / target, "wb") as file:
                write_header(file, *data.shape)
                for start in range(0, data.shape[0], BLOCK):
                    data[start : start + BLOCK].astype("<f4").tofile(file)
        neighbors = f["neighbors"][:, :DEPTH]
        with open(out / "groundtruth.ibin", "wb") as file:
            write_header(file, *neighbors.shape)
            neighbors.astype("<u4").tofile(file)
        distance = f.attrs["distance"]
        distance = distance.decode() if isinstance(distance, bytes) else distance
    (out / "metric").write_text({"angular": "cosine"}.get(distance, distance) + "\n")


def vector_column(schema):
    """The list column of a parquet file, whatever it is named."""
    for field in schema:
        if pa.types.is_list(field.type) or pa.types.is_large_list(field.type):
            return field.name
    raise SystemExit(f"no vector column in {schema}")


def vectors(batch, column):
    values = batch.column(column)
    return np.asarray(values.flatten(), dtype="<f4").reshape(len(batch), -1)


def write_parquet_vectors(paths, target):
    """Writes the vectors of `paths` one after another, in file order, and
    returns the ids, in that order. Large sets come as one huge row group
    per file, so each file is read in small buffered pieces and closed
    before the next: reading whole row groups of ten open files took
    40 GB."""
    rows = sum(pq.read_metadata(path).num_rows for path in paths)
    ids = []
    with open(target, "wb") as file:
        for path in paths:
            source = pq.ParquetFile(path, buffer_size=1 << 20, pre_buffer=False)
            column = vector_column(source.schema_arrow)
            for batch in source.iter_batches(batch_size=BLOCK, columns=["id", column]):
                block = vectors(batch, column)
                if not ids:
                    write_header(file, rows, block.shape[1])
                block.tofile(file)
                ids.append(batch.column("id").to_numpy())
            source.close()
    return np.concatenate(ids)


def train_parts(spec):
    """The train file names: one, or `parts` of them for large sets."""
    parts = spec.get("parts")
    if parts is None:
        return ["train"]
    return [f"train-{i:02d}-of-{parts}" for i in range(parts)]


def convert_parquet(folder, out, spec):
    """VectorDBBench files: train and test (id, emb), and neighbors
    (id of a test row, neighbors_id: ids of train rows)."""
    out.mkdir(parents=True, exist_ok=True)
    train = [folder / f"{part}.parquet" for part in train_parts(spec)]
    base_ids = write_parquet_vectors(train, out / "base.fbin")
    query_ids = write_parquet_vectors([folder / "test.parquet"], out / "query.fbin")
    table = pq.read_table(folder / "neighbors.parquet")
    lists = [c for c in table.column_names if c != "id"][0]
    by_query = dict(zip(table.column("id").to_pylist(), table.column(lists).to_pylist(), strict=True))
    neighbors = np.array([by_query[q][:DEPTH] for q in query_ids.tolist()], dtype=np.int64)
    # Ground truth names train ids; the bench names rows by position.
    order = np.argsort(base_ids)
    rows = order[np.searchsorted(base_ids[order], neighbors)]
    assert np.array_equal(base_ids[rows], neighbors), "a neighbour is not a train row"
    with open(out / "groundtruth.ibin", "wb") as file:
        write_header(file, *rows.shape)
        rows.astype("<u4").tofile(file)
    (out / "metric").write_text(spec["metric"] + "\n")


# Files fetched at once. Large sets come in parts, and one transfer from a
# dataset host rarely uses the machine's bandwidth.
DOWNLOADS = 4


def download(url, target):
    """With curl, which resumes a broken transfer and fails on a short one
    (urllib saw neither, and ann-benchmarks.com refuses its user agent)."""
    if target.exists():
        return
    started = time.monotonic()
    part = target.with_suffix(target.suffix + ".part")
    subprocess.run(
        ["curl", "-fsSL", "--retry", "10", "--retry-all-errors", "-C", "-", "-o", str(part), url],
        check=True,
    )
    part.rename(target)
    took = time.monotonic() - started
    size = target.stat().st_size
    log(f"got {target.name}: {size / 1e9:.1f} GB in {took:.0f} s ({size / 1e6 / max(took, 1e-9):.0f} MB/s)")


def download_all(urls, folder):
    """Every url into `folder`, a few at a time."""
    log(f"downloading {len(urls)} files, {DOWNLOADS} at a time")
    started = time.monotonic()
    with ThreadPoolExecutor(DOWNLOADS) as pool:
        for done in [pool.submit(download, url, folder / Path(url).name) for url in urls]:
            done.result()
    log(f"downloaded in {time.monotonic() - started:.0f} s")


def log(message):
    print(f"{time.strftime('%H:%M:%S')}  fetch     {message}", file=sys.stderr, flush=True)


def get(name, root):
    spec = SETS[name]
    out = root / name
    raw = root / f"{name}.download"
    raw.mkdir(parents=True, exist_ok=True)
    if "hdf5" in spec:
        urls = [spec["hdf5"]]
        download_all(urls, raw)
        convert_hdf5(raw / Path(urls[0]).name, out)
    elif "parquet" in spec:
        urls = [f"{spec['parquet']}/{part}.parquet" for part in (*train_parts(spec), "test", "neighbors")]
        download_all(urls, raw)
        log("converting to the bench's format")
        convert_parquet(raw, out, spec)
    else:
        urls = spec["text"]
        download_all(urls, raw)
        unpack_msmarco(raw, out)
    shutil.rmtree(raw)
    write_manifest(name, urls, out)
    print(out)


def unpack_msmarco(raw, out):
    """Passages, dev small queries and judgments from the archive; TREC DL 2019 queries and graded judgments."""
    out.mkdir(parents=True, exist_ok=True)
    with tarfile.open(raw / "collectionandqueries.tar.gz") as tar:
        for member in tar:
            name = Path(member.name).name
            if name in MSMARCO_FILES and member.isfile():
                with tar.extractfile(member) as src, open(out / name, "wb") as target:
                    shutil.copyfileobj(src, target, 1 << 20)
    with gzip.open(raw / "msmarco-test2019-queries.tsv.gz") as src, open(out / "queries.dl19.tsv", "wb") as target:
        shutil.copyfileobj(src, target)
    shutil.copy(raw / "2019qrels-pass.txt", out / "qrels.dl19.tsv")


def write_manifest(name, urls, out):
    manifest = {"source": name, "urls": urls}
    if (out / "base.fbin").exists():
        rows, dims = (int(x) for x in np.fromfile(out / "base.fbin", dtype="<u4", count=2))
        queries = int(np.fromfile(out / "query.fbin", dtype="<u4", count=1)[0])
        metric = (out / "metric").read_text().strip()
        manifest |= {"rows": rows, "dims": dims, "queries": queries, "metric": metric}
    (out / "dataset.json").write_text(json.dumps(manifest, indent=2) + "\n")


def read_bin(path, dtype):
    with open(path, "rb") as file:
        rows, dims = np.fromfile(file, dtype="<u4", count=2)
        return np.fromfile(file, dtype=dtype).reshape(rows, dims)


def self_test():
    """Converts tiny files made here and checks what comes out."""
    rng = np.random.default_rng(0)
    train = rng.standard_normal((250, 8)).astype("f4")
    test = rng.standard_normal((5, 8)).astype("f4")
    neighbors = rng.integers(0, 250, (5, 120)).astype("i4")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        with h5py.File(tmp / "t.hdf5", "w") as f:
            f["train"], f["test"], f["neighbors"] = train, test, neighbors
            f.attrs["distance"] = "angular"
        convert_hdf5(tmp / "t.hdf5", tmp / "h")
        assert np.array_equal(read_bin(tmp / "h/base.fbin", "<f4"), train)
        assert np.array_equal(read_bin(tmp / "h/query.fbin", "<f4"), test)
        assert np.array_equal(read_bin(tmp / "h/groundtruth.ibin", "<u4"), neighbors[:, :DEPTH])
        assert (tmp / "h/metric").read_text() == "cosine\n"

        # Train ids shuffled and not from 0, as in a real file.
        ids = rng.permutation(250) + 1000
        emb = pa.array(train.tolist(), type=pa.list_(pa.float32()))
        pq.write_table(pa.table({"id": ids, "emb": emb}), tmp / "train.parquet")
        # The same rows split in two, as a large set comes.
        for i, rows in enumerate((slice(0, 100), slice(100, 250))):
            part = pa.table({"id": ids[rows], "emb": emb[rows]})
            pq.write_table(part, tmp / f"train-{i:02d}-of-2.parquet")
        pq.write_table(
            pa.table({"id": [7, 3, 9, 1, 5], "emb": pa.array(test.tolist(), pa.list_(pa.float64()))}),
            tmp / "test.parquet",
        )
        truth = ids[neighbors[:, :DEPTH]]
        # Stored in another order than the test rows.
        pq.write_table(
            pa.table({"id": [1, 3, 5, 7, 9], "neighbors_id": [truth[i].tolist() for i in (3, 1, 4, 0, 2)]}),
            tmp / "neighbors.parquet",
        )
        for spec in ({"metric": "cosine"}, {"metric": "cosine", "parts": 2}):
            convert_parquet(tmp, tmp / "p", spec)
            assert np.array_equal(read_bin(tmp / "p/base.fbin", "<f4"), train)
            assert np.allclose(read_bin(tmp / "p/query.fbin", "<f4"), test)
            truth_rows = read_bin(tmp / "p/groundtruth.ibin", "<u4")
            assert np.array_equal(truth_rows, neighbors[:, :DEPTH])
    print("ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    fetch = commands.add_parser("get")
    fetch.add_argument("name", choices=sorted(SETS))
    fetch.add_argument("--dir", type=Path, default=DATA)
    commands.add_parser("self-test")
    args = parser.parse_args()
    if args.command == "list":
        print("\n\n".join(__doc__.split("\n\n")[2:]).strip())
    elif args.command == "get":
        get(args.name, args.dir)
    else:
        self_test()


if __name__ == "__main__":
    main()
