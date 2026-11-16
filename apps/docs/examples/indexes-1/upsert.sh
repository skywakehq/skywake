skywake upsert products products.jsonl
echo '{"id": 7, "text": "canvas tote bag", "price": 15}' | skywake upsert products -
skywake get products 7
