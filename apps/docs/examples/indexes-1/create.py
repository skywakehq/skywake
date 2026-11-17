from skywake import Skywake

sky = Skywake()

products = sky.create_index(
    "products",
    schema={
        "attributes": [
            {"name": "text", "type": "text"},
            {"name": "category", "type": "string"},
            {"name": "price", "type": "number"},
        ],
    },
)

print(products.info()["schema"])
