from skywake import PermissionError, Skywake

sky = Skywake()
sky.index("products").upsert({"id": 1, "text": "red running shoes"})

made = sky.create_key(
    "agent-1",
    "write",
    environment="default",
    only=["products"],
    expires_in_days=30,
)

agent = Skywake(key=made["key"])
agent.index("products").upsert({"id": 2, "text": "waterproof hiking boots"})

try:
    agent.index("billing").upsert({"id": 1, "text": "hello"})
except PermissionError as error:
    print("billing:", error.message)

for key in sky.list_keys():
    print(key["id"], key["name"], key["role"], key["environment"] or "every", ",".join(key["only"]))

sky.revoke_key(made["id"])
