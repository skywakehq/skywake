from skywake import Skywake

products = Skywake().index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})

products.configure(pinned={"replicas": 2})
print("pinned")
