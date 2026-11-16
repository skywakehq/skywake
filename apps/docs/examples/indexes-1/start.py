from skywake import Skywake

sky = Skywake()
products = sky.index("products")

products.upsert([
    {"id": 1, "text": "red running shoes", "price": 89},
    {"id": 2, "text": "waterproof hiking boots", "price": 140},
    {"id": 3, "text": "cotton sun hat", "price": 25},
])

hits = products.query("shoes for running", limit=2)
print(hits)
