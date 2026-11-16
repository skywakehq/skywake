from skywake import Skywake

products = Skywake().index("products")
products.upsert(
    [
        {"id": 1, "text": "red running shoes", "tag": "shoes", "price": 89},
        {"id": 2, "text": "trail shoes", "tag": "shoes", "price": 120},
        {"id": 3, "text": "wool socks", "tag": "socks", "price": 12},
    ]
)

groups = products.aggregate(group_by="tag", sum="price", min="price", filter={"price": {"gt": 0}})
print(groups)
