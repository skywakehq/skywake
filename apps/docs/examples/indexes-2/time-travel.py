from skywake import Skywake

products = Skywake().index("products")
products.upsert({"id": 1, "text": "red running shoes", "price": 89})

draft = products.fork("draft")
draft.upsert({"id": 2, "text": "trail shoes", "price": 120})
print("main", products.count(), "draft", draft.count())

merged = draft.merge_into("main")
print("merged", merged["rows"], "rows; main has", products.count())
draft.destroy()
