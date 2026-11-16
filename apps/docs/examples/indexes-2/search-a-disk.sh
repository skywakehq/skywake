skywake create disk app --search
echo "Retry failed requests with exponential backoff." | skywake write app/docs/retries.md
echo "Sign requests with your API key." | skywake write app/docs/auth.md

for _ in $(seq 50); do
  skywake query app "retry backoff" --limit 1 | grep retries.md >/dev/null && break
  sleep 0.2
done
skywake query app "retry backoff" --limit 1
