from skywake import Skywake

sky = Skywake()

docs = sky.create_index(
    "docs",
    schema={
        "vectors": [{"name": "embedding", "dims": 3, "metric": "cosine", "element": "f16"}],
        "attributes": [
            {"name": "tenant", "type": "string", "filter_index": True},
            {"name": "stars", "type": "int"},
            {"name": "published", "type": "datetime"},
            {"name": "labels", "type": "strings"},
            {"name": "body", "type": "text", "language": "english"},
        ],
        "id": "uuid",
    },
)

docs.upsert(
    {
        "id": "4f1c2a9e-8b3d-4e5f-9a1b-2c3d4e5f6a7b",
        "embedding": [0.1, 0.2, 0.3],
        "tenant": "acme",
        "stars": 4,
        "published": "2026-11-09T10:00:00Z",
        "labels": ["guide"],
        "body": "How to reset a password",
    }
)

print(docs.get("4f1c2a9e-8b3d-4e5f-9a1b-2c3d4e5f6a7b"))
