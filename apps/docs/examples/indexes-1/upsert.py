from skywake import Skywake

products = Skywake().index("products")

one = products.upsert({"id": 1, "text": "red running shoes", "price": 89})
print(one)

many = products.upsert(
    [
        {"id": 2, "text": "trail running shoes", "price": 120},
        {"text": "cotton sun hat", "price": 25},
    ]
)
print(many)
