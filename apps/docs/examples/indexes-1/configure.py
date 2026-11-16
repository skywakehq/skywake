from skywake import Skywake

products = Skywake().index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})

info = products.configure(
    attributes=[{"name": "launched", "type": "datetime"}],
    retention_days=30,
)
print(info["schema"]["attributes"], info["retention_days"])
