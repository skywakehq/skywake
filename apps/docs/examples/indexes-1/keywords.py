from skywake import Skywake

sky = Skywake()

articles = sky.create_index(
    "articles",
    schema={
        "attributes": [
            {"name": "title", "type": "text"},
            {"name": "body", "type": "text", "language": "english", "stopwords": True, "k1": 1.2, "b": 0.75},
        ],
    },
    embed=False,
)

articles.upsert([
    {"id": 1, "title": "Reset your password", "body": "Open Settings and choose a new password."},
    {"id": 2, "title": "Change your email", "body": "Your password is needed to change your email."},
    {"id": 3, "title": "Delete your account", "body": "Deleting an account can't be undone."},
])

hits = articles.query("resetting passwords", mode="keywords", fields=["title"])
print(hits)

phrase = articles.query(
    "password",
    mode="keywords",
    filter={"body": {"phrase": "new password"}},
    fields=["title"],
)
print(phrase)
