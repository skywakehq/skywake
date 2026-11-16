skywake upsert products products.jsonl
skywake query products shoes --filter "category = shoes and price < 130"
skywake query products --filter "(category = hats or price >= 120) and not in_stock = false"
skywake query products --filter '{"tags": {"contains": "sale"}}' --fields text,tags
