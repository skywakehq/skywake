from skywake import NotFound, Skywake

sky = Skywake()
sky.index("products").upsert({"id": 1, "text": "red running shoes", "price": 89})

try:
    sky.index("prodcts").query("shoes")
except NotFound as error:
    print(error.code, error.message)
    print("hint:", error.hint)
