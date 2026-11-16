skywake upsert products products.jsonl
skywake query products "shoes for running" --filter "price < 100"

skywake fork products draft
echo '{"id": 4, "text": "trail running shoes", "category": "shoes", "price": 95}' \
  | skywake upsert products@draft -
skywake query products@draft "trail shoes" --limit 3

skywake merge products@draft
skywake get products 4
