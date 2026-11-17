skywake upsert images images.jsonl
skywake query images --vector '[0.2, 0.8, 0.0]' --limit 2
skywake query images --vector '[0.2, 0.8, 0.0]' --filter "width >= 800" --fields label
