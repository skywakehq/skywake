from skywake import Skywake

sky = Skywake()
products = sky.index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})

backup = products.copy("products-backup")

for index in sky.list_indexes():
    print(index["name"])

backup.destroy()
print(products.info())
