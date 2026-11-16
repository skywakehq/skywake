from skywake import Skywake

products = Skywake().index("products")
products.upsert([
    {"id": 1, "text": "red running shoes", "category": "shoes"},
    {"id": 2, "text": "wool beanie", "category": "hats"},
    {"id": 3, "text": "trail running shoes", "category": "shoes"},
])

for row in products.rows():
    print(row)

for row in products.rows(filter={"category": "shoes"}):
    print(row["id"])
