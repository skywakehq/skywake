**cohere-10m**: 10000000 rows × 768 dims, cosine, store s3://skywake-bench-<account>-ap-southeast-2/index/, k=10, 300 warm / 50 cold queries, pre-release code

Client: aws i4i.4xlarge in ap-southeast-2, the same region as the bucket. Written by hand from the run's event log: the run
measured everything below, then failed while deleting its test objects (S3 returned 503 SlowDown), so it wrote no report.

load 5m 35s (10,000,000 rows, 8 writers) · build 22m 32s (5,000 clusters, 64.5 GB) · write→visible p50 288.1 ms

| filter | probe   | pass           | recall@k | p50 ms | p99 ms |
| ------ | ------- | -------------- | -------- | -----: | -----: |
| all    | default | cold           | 0.950    |  411.0 |  620.6 |
| all    | default | warm           | 0.956    |  182.0 |  252.6 |
| all    | default | warm+disk      | 0.956    |  131.2 |  209.2 |
| all    | default | warm+disk+head | 0.956    |   10.1 |   95.5 |
| 1%     | default | cold           | 0.968    |  386.8 |  554.0 |
| 1%     | default | warm           | 0.956    |  122.6 |  186.3 |
| 1%     | default | warm+disk      | 0.956    |   48.7 |   72.1 |
| 1%     | default | warm+disk+head | 0.956    |   24.2 |   46.2 |
