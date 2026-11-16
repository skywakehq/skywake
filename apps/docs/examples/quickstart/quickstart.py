from skywake import Skywake

app = Skywake().disk("app")
app.write("hello.txt", "hi")
print(app.read("hello.txt"))
