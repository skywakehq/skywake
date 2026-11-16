from skywake import Skywake

products = Skywake().index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})
products.update(1, {"price": 79})

before = products.versions()[1]
print("now", products.get(1)["price"])

audit = products.fork("audit", at=before["id"])
print("audit", audit.get(1)["price"])

products.restore(before["id"])
print("restored", products.get(1)["price"])
