# Skywake on Kubernetes

This chart runs Skywake in your own cloud account. Your data never leaves
it: branches and indexes stay in your bucket, and the control plane stays
in your Postgres.

| Runs in the cluster | What it is                                                       |
| ------------------- | ---------------------------------------------------------------- |
| `api`               | The API. It keeps no state, so it scales with the load (HPA)     |
| `console`           | The web console                                                  |
| `zero`              | zero-cache, which keeps the console up to date                   |
| `cache`             | The shared chunk cache: each object is read from the bucket once |
| `docs`              | The documentation, optional (`docs.enabled`)                     |

| You bring  | Notes                                                            |
| ---------- | ---------------------------------------------------------------- |
| Postgres   | 15 or newer, with `wal_level=logical` for zero-cache             |
| A bucket   | Object storage with conditional writes (AWS S3, R2, GCS via S3…) |
| An ingress | For the console, the API and zero-cache, with HTTPS              |

## Install

Every release publishes the chart and its images on ghcr.io. On AWS, the
Terraform module in `deploy/terraform/aws` makes the bucket, RDS and the
IAM role and installs the chart; the steps below are for doing it by hand.

1. Make the database roles. Either let the chart do it (`bootstrap.enabled:
true` and a Secret named `skywake-bootstrap` with the owner's `host`,
   `port`, `user`, `password` and `database`, and `api-password`,
   `console-password` and `zero-password`), or run
   `docker/postgres/roles.sh` once yourself as the database's owner, with
   `PGHOST`, `POSTGRES_USER`, `POSTGRES_DB` and the three passwords
   (`API_DB_PASSWORD`, `CONSOLE_DB_PASSWORD`, `ZERO_DB_PASSWORD`) set. On
   Amazon RDS it grants the `rds_replication` role instead of
   `REPLICATION`.
2. Make the Secret. Every key is required, except the AWS keys, which are
   read only with `aws.keysFromSecret: true`, and `peer-token`, without
   which a pinned index's queries are answered by whichever copy gets them
   instead of going to its replicas:

   ```bash
   kubectl create secret generic skywake \
     --from-literal=api-database-url=postgres://skywake_api:…@db/skywake \
     --from-literal=console-database-url=postgres://skywake_console:…@db/skywake \
     --from-literal=zero-database-url=postgres://skywake_zero:…@db/skywake \
     --from-literal=admin-token="$(openssl rand -hex 32)" \
     --from-literal=better-auth-secret="$(openssl rand -hex 32)" \
     --from-literal=zero-admin-password="$(openssl rand -hex 16)" \
     --from-literal=cache-token="$(openssl rand -hex 32)" \
     --from-literal=peer-token="$(openssl rand -hex 32)"
   ```

   On RDS, which requires TLS, end the API's and the console's URLs with
   `?sslmode=no-verify` and zero-cache's with `?sslmode=require`.

3. Install. The images are `ghcr.io/skywakehq/skywake-<component>` at the
   chart's version; `images.registry` points at a mirror, and each
   component's `image` replaces both with a full reference.

   ```bash
   helm install skywake oci://ghcr.io/skywakehq/charts/skywake \
     --set store=s3://my-bucket \
     --set aws.region=eu-central-1 \
     --set console.url=https://console.example.com \
     --set console.apiUrl=https://api.example.com \
     --set console.zeroUrl=https://zero.example.com
   ```

4. Route your ingress to the `skywake-console` (3100), `skywake-api` (8080)
   and `skywake-zero` (4848) services, or set `ingress.enabled: true` and
   `ingress.hosts` for the chart to make one Ingress.

Keep the cluster, Postgres and the bucket in one region: commits make
several bucket requests one after another, and every API write waits on
Postgres. The API logs a warning at startup when either is far away.

## Docs

Set `docs.enabled: true`. They need nothing else in the chart. Their base path is fixed when the image
is built: `/docs` by default, so with the chart's Ingress they answer at
`/docs` (and their files at `/docs-static`) on `ingress.hosts.docs`, which
can be your site's host. For a host of their own, build with
`--build-arg DOCS_BASE_PATH=` and set `docs.basePath: ""`.

## Access to the bucket

On EKS, give the pods an IAM role through IRSA instead of keys:

```yaml
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/skywake
```

The role needs read, write, list and delete on the bucket. To encrypt with
your own KMS key, set it as the bucket's default encryption; the role then
also needs `kms:Encrypt`, `kms:Decrypt` and `kms:GenerateDataKey` on it.

## Scaling

- `api`: a HorizontalPodAutoscaler adds copies above 70% CPU, from 2 to 20
  (`api.autoscaling`). Keep `max × api.databasePool` under Postgres's
  `max_connections`.
- `cache`: a fixed number of nodes (`cache.replicas`), each with its own
  disk. Each chunk belongs to one node, so changing the count moves most
  chunks; pick it once and grow the disks instead.
- `console` and `zero`: small; two console copies and one zero-cache.

## Upgrade

```bash
helm upgrade skywake oci://ghcr.io/skywakehq/charts/skywake --version 0.2.0 --reset-then-reuse-values
```

`--reset-then-reuse-values` (Helm 3.14+) keeps your values and takes the
new version's defaults for the rest; plain `--reuse-values` would skip
settings the new version adds.

The API and the console update their tables when they start.
