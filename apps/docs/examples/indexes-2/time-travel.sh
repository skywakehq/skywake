echo '{"id": 1, "text": "red running shoes", "price": 89}' | skywake upsert products -
skywake fork products draft
echo '{"id": 2, "text": "trail shoes", "price": 120}' | skywake upsert products@draft -
skywake query products@draft "shoes"
skywake merge products@draft --into main
skywake branches products
skywake destroy products@draft --yes
