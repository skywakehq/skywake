# Append builds for the vector index

A bulk import used to stall on index builds. Every build rewrote each cluster a new row landed in, and a build
became a full rebuild (k-means, then assigning every row) whenever the tail passed half the index or the index
doubled since its last full build. A 10M import ran about ten full rebuilds, and the writer refused writes
(HTTP 429) while 2 GiB waited.

Builds now append. Their cost follows the rows written since the last build, not the size of the index.

## Pieces and groups

A column's cluster table holds pieces. A piece is an ordinary cluster blob (`swc2`), RaBitQ-encoded on its own
with its own anchor scale and radius. Pieces whose centroids are bit-for-bit equal form a group, and a group is
one IVF cluster. The piece with the most rows is the group's base; the others are its deltas. A piece with no
rows is spare and can be handed to any group.

- An append assigns each new row to a group and writes one new delta per group it touched, holding just those
  rows. The base is not read.
- Rows leaving a piece (deletes, and upserts of ids already built) rewrite only that piece.
- Deltas of about the same size merge once four pile up (size tiers of 4×), which bounds how many a group has.
- A group folds back into one base once its deltas hold half as many rows as the base.
- Groups that grow past twice `cluster_rows` split into parts of about half that, and small groups merge into
  their neighbour to free a place, using the same `Plan` as before. Splitting on an absolute size lets the
  number of clusters grow with the data instead of retraining.
- Each build gets a reorganisation budget of four times the bytes of its new rows (at least 64 MiB, at most
  the build's memory budget). Splits take it biggest first, then folds take what is left, most overdue first;
  the rest waits for a later build. This keeps one build from rewriting a large share of the index at once.

Queries need no new read path: `known.get(c)`, `cluster.vectors()` and `exact` already read any table entry.
The planner counts groups, not entries. Equal centroids give equal scores, so a group's pieces sit next to each
other in the probe order and are read together; a probe of `n` clusters reads the first `n` groups.

With many clusters, new rows are assigned through a coarse level: the group centroids are clustered into about
√G tops, and a row is compared with the groups under its nearest few tops instead of all of them.

## When a full build still runs

- There is no index yet.
- Training early: while the whole index holds at most 100k rows and has grown fourfold since its last training.
  After that the clusters stay trained and grow by splits.
- Quality falls: groups are badly unbalanced after the local plan, or deletes removed more than a fifth of the
  live rows.
- `rebuild()` asks for one.

## Calibration

Calibration says what share of clusters a query reads for a recall. It is measured against the groups that
exist, so it goes stale as splits add groups, and a stale share loses recall (300k rows grown from 40k by
splits: 0.927 at the default target before measuring again, 0.974 after). Once the groups have grown by half
since the last measurement, the builder measures again in the background: 200 sample rows as queries, exact
neighbours over every row, the same `Calibrator`. It saves only the calibration, with the same compare-and-swap
as a build, and does not hold up appends. `Index::recalibrate` runs the same step for callers that build by hand.

## Format

Format 15 adds two numbers to each column's `Clusters`: `groups` (distinct centroids) and `calibrated` (groups
when the calibration was measured). Blobs, pages, the row map and the directory are unchanged.

- Format 14 and older still load: `groups` and `calibrated` become the table length, which is exact for indexes
  with one piece per centroid.
- A version is still written in the oldest format that holds it. Format 15 is written only once a column has
  pieces sharing a centroid or a calibration over a different group count, so older binaries keep reading an
  index until it has deltas.
- An old index needs no migration step: its first append groups the pieces it finds.

## Crash safety

An append writes new content-addressed blobs and pages, then saves the Version with the same compare-and-swap as
before. Nothing is written in place. A crash before the save leaves the previous Version, which names only blobs
that were complete when it was saved; the blobs written meanwhile are garbage for `gc`. An append applies only
if the index it started from is still current, ignoring a calibration saved meanwhile, so two builders, or a
build and a recalibration, never lose each other's work.

## Backpressure

Writes slow down before they fail. Past the soft limit (`unbuilt_bytes`, now 4 GiB) each write waits in
proportion to how far over it is, up to 2 s, giving the builder time; past the hard limit (four times the soft
one) a write gets `Busy` (HTTP 429) as before.
