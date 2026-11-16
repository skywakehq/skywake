from skywake import Skywake

products = Skywake().index("products")
products.upsert([
    {"id": 1, "text": "red running shoes", "price": 89, "stock": 4, "badge": "new"},
    {"id": 2, "text": "wool beanie", "price": 30, "stock": 0},
    {"id": 3, "text": "cotton sun hat", "price": 25, "stock": 0},
])

products.update(1, {"price": 79, "badge": None})
products.update({"stock": 0}, {"status": "sold out"})
print(products.get(1))
print(products.get(2))

products.delete(2)
products.delete({"filter": {"status": "sold out"}})
print(products.get(2), products.count())
