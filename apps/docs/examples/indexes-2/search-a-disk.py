import time

from skywake import Skywake

sky = Skywake()
app = sky.create_disk("app", search=True)
app.write(
    {
        "docs/retries.md": "Retry failed requests with exponential backoff.",
        "docs/auth.md": "Sign requests with your API key.",
    }
)

hits = app.query("retry backoff", limit=1)
for _ in range(50):
    if hits:
        break
    time.sleep(0.2)
    hits = app.query("retry backoff", limit=1)
print(hits)
