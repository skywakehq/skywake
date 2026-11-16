from skywake import Skywake

articles = Skywake().index("articles")
articles.upsert(
    [
        {"id": 1, "title": "Reset your password", "text": "Open settings and choose reset password."},
        {"id": 2, "title": "Sign-in problems", "text": "If you can't log in, check your email first."},
        {"id": 3, "title": "Billing", "text": "Change your card on the billing page."},
    ]
)

for mode in ["auto", "meaning", "keywords"]:
    hits = articles.query("reset password", mode=mode, limit=2)
    print(mode, [hit["title"] for hit in hits])
