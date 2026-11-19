from skywake import Skywake

products = Skywake().index("products")
products.upsert(
    [
        {"id": 1, "text": "red running shoes", "price": 89},
        {"id": 2, "text": "waterproof hiking boots", "price": 140},
    ]
)
print(products.query("shoes for running", filter={"price": {"lt": 100}}))
