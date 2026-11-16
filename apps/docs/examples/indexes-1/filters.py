import json

from skywake import Skywake

products = Skywake().index("products")
with open("products.jsonl") as file:
    products.upsert([json.loads(line) for line in file])

shoes = products.query(
    "shoes",
    filter={"category": "shoes", "price": {"lt": 130}, "tags": {"contains": "running"}},
    fields=["text", "price"],
)
print(shoes)

in_stock = products.query(
    filter={
        "or": [{"category": "hats"}, {"price": {"gte": 120}}],
        "not": {"in_stock": False},
    },
    fields=["text", "price"],
)
print(in_stock)
