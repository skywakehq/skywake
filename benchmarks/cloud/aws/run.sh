#!/bin/bash
# Runs the benchmarks on real AWS: a bucket, a KMS key and one machine with
# NVMe, next to each other in one region. The machine runs everything on its
# own (benchmarks/cloud/aws/instance.sh), saves the results to the bucket and turns
# itself off. Nothing here needs SSH.
#
#   benchmarks/cloud/aws/run.sh plan     what it creates and what it costs
#   benchmarks/cloud/aws/run.sh up       creates it all and starts the run
#   benchmarks/cloud/aws/run.sh status   the machine, the results so far, the log's end
#   benchmarks/cloud/aws/run.sh fetch    copies the results to benchmarks/results/aws-*/
#   benchmarks/cloud/aws/run.sh down     deletes everything it created
#
# Uses your AWS CLI login. INSTANCE (i4i.4xlarge) and HOURS (8, the most the
# machine runs before it turns itself off) change the defaults. MINI=1 runs
# only the keys check and the index, on SETS (sift-1m cohere-1m), with
# INDEX_ARGS added to each index run (such as --filters none,1).
# FILESYSTEM=1 runs only the filesystem suites, latency included, with
# FS_ARGS added (such as --repeat 3 or --quick).
set -euo pipefail
cd "$(dirname "$0")/../../.."

REGION=${AWS_REGION:-$(aws configure get region || true)}
REGION=${REGION:-us-west-2}
INSTANCE=${INSTANCE:-i4i.4xlarge}
MINI=${MINI:-0}
FILESYSTEM=${FILESYSTEM:-0}
FS_ARGS=${FS_ARGS:-}
SETS=${SETS:-$([ "$MINI" = 1 ] && echo "sift-1m cohere-1m" || echo "sift-1m cohere-10m")}
INDEX_ARGS=${INDEX_ARGS:-}
HOURS=${HOURS:-$([ "$MINI" = 1 ] || [ "$FILESYSTEM" = 1 ] && echo 2 || echo 8)}
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
# Every name comes from the account and region, so `down` needs no saved state.
NAME=skywake-bench
BUCKET=$NAME-$ACCOUNT-$REGION
ALIAS=alias/$NAME

instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}

key_id() {
  aws kms describe-key --key-id "$ALIAS" --query KeyMetadata.Arn --output text 2>/dev/null || true
}

# The working tree as it is, uncommitted changes included, without anything
# git ignores and without secrets.
pack_source() {
  git ls-files -co --exclude-standard -z \
    | while IFS= read -r -d '' f; do [ -f "$f" ] && printf '%s\0' "$f"; done \
    | grep -zvE '(^|/)\.env|\.pem$|(^|/)r2\.env$' \
    | tar --null -T - -czf "$1"
}

plan() {
  if [ "$FILESYSTEM" = 1 ]; then
    cat <<EOF
Account $ACCOUNT, region $REGION. A filesystem run.

Creates:
  bucket        s3://$BUCKET
  KMS key       $ALIAS (this run doesn't use it)
  IAM role      $NAME, with an instance profile: this bucket and this key only
  machine       $INSTANCE (Amazon Linux 2023), turns itself off and is
                deleted when the run ends, or after $HOURS hours at most

Runs benchmarks/filesystem/run.py on the bucket: store, mount, save, daemon,
fleet and latency${FS_ARGS:+, with $FS_ARGS}.

Cost: the machine bills by the second, about \$1.90/hour for an i4i.4xlarge
here, for at most $HOURS hours. Storage and requests are a few cents.
EOF
    return
  fi
  if [ "$MINI" = 1 ]; then
    cat <<EOF
Account $ACCOUNT, region $REGION. A mini run.

Creates:
  bucket        s3://$BUCKET (SSE-C allowed, for the keys check)
  KMS key       $ALIAS (for the customer-managed key check)
  IAM role      $NAME, with an instance profile: this bucket and this key only
  machine       $INSTANCE (Amazon Linux 2023), turns itself off and is
                deleted when the run ends, or after $HOURS hours at most

Runs, in order, saving results to the bucket after each:
  1. customer-managed keys (SSE-KMS and SSE-C) on the real bucket
  2. index on S3, cold, warm and warm from the NVMe cache, for each of:
     $SETS${INDEX_ARGS:+
     with $INDEX_ARGS}

Cost: the machine bills by the second, about \$1.90/hour for an i4i.4xlarge
here, for at most $HOURS hours.
The KMS key is about \$0.25 (deleted 7 days after \`down\`). Storage and
requests are a few cents.
EOF
    return
  fi
  cat <<EOF
Account $ACCOUNT, region $REGION.

Creates:
  bucket        s3://$BUCKET
  KMS key       $ALIAS (for the customer-managed key check)
  IAM role      $NAME, with an instance profile: this bucket and this key only
  machine       $INSTANCE (Amazon Linux 2023), turns itself off and is
                deleted when the run ends, or after $HOURS hours at most

Runs, in order, saving results to the bucket after each:
  1. customer-managed keys (SSE-KMS and SSE-C) on the real bucket
  2. index: SIFT-1M on S3, cold, warm and warm from the NVMe cache
  3. index: Cohere 10M x 768, the same
  4. filesystem: benchmarks/filesystem/run.py, every suite, 5 runs each
  5. pinned indexes: 1M rows through three API servers, unpinned, 1 and 3 replicas

Cost: the machine bills by the second. An i4i.4xlarge is about \$1.40/hour in
us-east-1 and up to about \$1.90 in other regions; the run takes 4-5 hours
(\$6-10), and \$15 at most. The KMS key is about \$0.25 (\$1/month, deleted
7 days after \`down\`). Storage and requests are a few cents. Traffic
between the machine and the bucket is free.
EOF
}

up() {
  [ -z "$(instance_id)" ] || { echo "A run is already going: benchmarks/cloud/aws/run.sh status" >&2; exit 1; }

  aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || {
    if [ "$REGION" = us-east-1 ]; then
      aws s3api create-bucket --bucket "$BUCKET" >/dev/null
    else
      aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    fi
  }
  # New buckets refuse SSE-C uploads; the keys check needs them.
  aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"},
               "BlockedEncryptionTypes": {"EncryptionType": ["NONE"]}}]
  }'

  local key
  key=$(key_id)
  if [ -z "$key" ]; then
    key=$(aws kms create-key --description "Skywake benchmark: customer-managed key check" \
      --query KeyMetadata.Arn --output text)
    aws kms create-alias --alias-name "$ALIAS" --target-key-id "$key"
  fi

  if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
    aws iam create-role --role-name "$NAME" --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' >/dev/null
    aws iam put-role-policy --role-name "$NAME" --policy-name "$NAME" --policy-document '{
      "Version": "2012-10-17",
      "Statement": [
        {"Effect": "Allow", "Action": "s3:*", "Resource": ["arn:aws:s3:::'"$BUCKET"'", "arn:aws:s3:::'"$BUCKET"'/*"]},
        {"Effect": "Allow", "Action": ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"], "Resource": "'"$key"'"}
      ]
    }'
    aws iam create-instance-profile --instance-profile-name "$NAME" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  fi

  local tarball
  tarball=$(mktemp -d)/source.tar.gz
  pack_source "$tarball"
  aws s3 cp --quiet "$tarball" "s3://$BUCKET/source.tar.gz"
  aws s3 cp --quiet benchmarks/cloud/aws/instance.sh "s3://$BUCKET/instance.sh"
  aws s3 rm --quiet --recursive "s3://$BUCKET/results/" || true

  local commit note
  commit=$(git rev-parse --short HEAD)
  note="commit $commit$([ -z "$(git status --porcelain --untracked-files=no)" ] || echo ' with uncommitted changes')"

  local ami
  ami=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text)
  local userdata
  userdata=$(mktemp)
  cat >"$userdata" <<EOF
#!/bin/bash
export HOME=/root BUCKET=$BUCKET KMS_KEY=$key INSTANCE=$INSTANCE HOURS=$HOURS MINI=$MINI FILESYSTEM=$FILESYSTEM FS_ARGS="$FS_ARGS" SETS="$SETS" INDEX_ARGS="$INDEX_ARGS" NOTE="$note"
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
aws s3 cp s3://$BUCKET/instance.sh /root/instance.sh && bash /root/instance.sh
EOF

  # A new instance profile takes a few seconds to be usable.
  local id=""
  for _ in 1 2 3 4 5 6; do
    id=$(aws ec2 run-instances --image-id "$ami" --instance-type "$INSTANCE" \
      --iam-instance-profile "Name=$NAME" \
      --instance-initiated-shutdown-behavior terminate \
      --metadata-options HttpTokens=required \
      --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
      --user-data "file://$userdata" \
      --query 'Instances[0].InstanceId' --output text 2>"$userdata.err") && break
    sleep 10
  done
  [ -n "$id" ] || { cat "$userdata.err" >&2; echo "Could not start the machine." >&2; exit 1; }
  echo "Started $id ($INSTANCE, $REGION). benchmarks/cloud/aws/run.sh status shows how it goes."
}

status() {
  local id
  id=$(instance_id)
  echo "machine: ${id:-none running}"
  aws s3 ls "s3://$BUCKET/results/" 2>/dev/null || echo "no results yet"
  aws s3 cp --quiet "s3://$BUCKET/results/run.log" - 2>/dev/null | tail -n 15 || true
}

fetch() {
  local out
  out=benchmarks/results/aws-$(date +%Y%m%d-%H%M%S)
  aws s3 cp --quiet --recursive "s3://$BUCKET/results/" "$out"
  echo "Saved to $out/"
}

down() {
  local id
  id=$(instance_id)
  if [ -n "$id" ]; then
    aws ec2 terminate-instances --instance-ids $id >/dev/null
    aws ec2 wait instance-terminated --instance-ids $id
  fi
  if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    aws s3 rm --quiet --recursive "s3://$BUCKET"
    aws s3api delete-bucket --bucket "$BUCKET"
  fi
  if aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
    aws iam remove-role-from-instance-profile --instance-profile-name "$NAME" --role-name "$NAME" 2>/dev/null || true
    aws iam delete-instance-profile --instance-profile-name "$NAME" 2>/dev/null || true
    aws iam delete-role-policy --role-name "$NAME" --policy-name "$NAME"
    aws iam delete-role --role-name "$NAME"
  fi
  local key
  key=$(key_id)
  if [ -n "$key" ]; then
    aws kms delete-alias --alias-name "$ALIAS"
    aws kms schedule-key-deletion --key-id "$key" --pending-window-in-days 7 >/dev/null
  fi
  echo "Deleted the machine, the bucket and the role. The KMS key goes in 7 days."
}

case "${1:-}" in
  plan | up | status | fetch | down) "$1" ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
esac
