import json

from skywake import Skywake

products = Skywake().index("products")
with open("products.jsonl") as file:
    products.upsert([json.loads(line) for line in file])

priciest = products.query(
    filter={"category": "shoes"},
    sort={"price": "desc"},
    limit=2,
    fields=["text", "price"],
)
print(priciest)
