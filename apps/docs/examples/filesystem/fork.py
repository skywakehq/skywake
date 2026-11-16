from skywake import Skywake

sky = Skywake()
app = sky.disk("app")
app.write("src/auth.py", "TIMEOUT = 30\n")

work = app.fork("agent-1")
work.write("src/auth.py", "TIMEOUT = 60\n")

print("main:   ", app.read("src/auth.py"))
print("agent-1:", work.read("src/auth.py"))
print([branch["name"] for branch in app.branches()])

work.destroy()
