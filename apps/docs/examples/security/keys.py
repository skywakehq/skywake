from skywake import PermissionError, Skywake

sky = Skywake()
sky.create_disk("app")

made = sky.create_key(
    "agent-1",
    "write",
    environment="default",
    only=["app"],
    expires_in_days=30,
)

agent = Skywake(key=made["key"])
agent.disk("app").write("notes.md", "hello")

try:
    agent.disk("billing").write("notes.md", "hello")
except PermissionError as error:
    print("billing:", error.message)

for key in sky.list_keys():
    print(key["id"], key["name"], key["role"], key["environment"] or "every", ",".join(key["only"]))

sky.revoke_key(made["id"])
