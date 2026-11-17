from skywake import MergeConflict, Skywake

app = Skywake().disk("app")
app.write({"README.md": "# App\n", "config.toml": "retries = 3\n"})

work = app.fork("agent-1")
work.write("src/session.py", "TTL = 3600\n", message="Add sessions")
work.write("config.toml", "retries = 5\n")
app.write("config.toml", "retries = 10\n")

print(work.diff("main"))

try:
    work.merge_into("main")
except MergeConflict as error:
    print("conflicts:", error.conflicts)
    merged = work.merge_into("main", prefer="theirs")
    print("merged as", merged["commit"])

print(app.read("config.toml"))
