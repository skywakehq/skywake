import json

from skywake import Skywake

products = Skywake().index("products")
products.upsert({
    "id": 1,
    "text": "red running shoes",
    "price": 89,
    "in_stock": True,
    "tags": ["sale", "running"],
})

print(json.dumps(products.info()["schema"], indent=2))
