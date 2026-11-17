from skywake import Skywake

images = Skywake().index("images")
images.upsert(
    [
        {"id": "cat.jpg", "caption": "a cat sleeps", "embedding": [0.9, 0.1, 0.0]},
        {"id": "dog.jpg", "caption": "a dog runs", "embedding": [0.1, 0.9, 0.2]},
    ]
)

hits = images.query(vector=[0.8, 0.2, 0.1], limit=1)
print([(hit["id"], hit["caption"]) for hit in hits])
