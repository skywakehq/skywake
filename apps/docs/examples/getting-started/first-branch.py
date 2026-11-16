from skywake import Skywake

app = Skywake().disk("app")

app.write({"README.md": "# Shop\n", "config.toml": "port = 8080\n"}, message="first version")

work = app.fork("agent-1")
work.write("config.toml", "port = 9090\n", message="change the port")

print(work.diff("main"))

work.merge_into("main")
print(app.read("config.toml"))
