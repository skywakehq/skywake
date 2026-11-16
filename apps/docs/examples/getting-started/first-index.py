from skywake import Skywake

products = Skywake().index("products")

products.upsert(
    [
        {"id": 1, "text": "red running shoes", "category": "shoes", "price": 89},
        {"id": 2, "text": "waterproof hiking boots", "category": "shoes", "price": 140},
        {"id": 3, "text": "cotton running socks", "category": "socks", "price": 12},
    ]
)

for hit in products.query("shoes for running", filter={"price": {"lt": 100}}):
    print(hit["id"], hit["text"], hit["price"])

draft = products.fork("draft")
draft.upsert({"id": 4, "text": "trail running shoes", "category": "shoes", "price": 95})
print("draft:", draft.count(), "main:", products.count())

draft.merge_into("main")
print("main after merge:", products.count())
