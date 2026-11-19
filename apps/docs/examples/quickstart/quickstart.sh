echo '{"id": 1, "text": "red running shoes", "price": 89}' | skywake upsert products -
skywake query products "shoes for running" --filter "price < 100"
