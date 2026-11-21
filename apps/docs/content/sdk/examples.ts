// One example per SDK operation per language. `scripts/check-sdk-examples.ts`
// checks that each one calls only what its SDK defines.

export const languages = ["typescript", "python", "go", "ruby", "rust", "java", "csharp"] as const;
export type Language = (typeof languages)[number];
export const labels: Record<Language, string> = {
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  rust: "Rust",
  java: "Java",
  csharp: "C#",
};

export interface SdkOperation {
  slug: string;
  title: string;
  description: string;
  examples: Partial<Record<Language, string>>;
}

export const operations: SdkOperation[] = [
  {
    slug: "connect",
    title: "Connect",
    description: "Make a client with the API's URL and an API key.",
    examples: {
      typescript: `import { Skywake } from "skywake";

const sky = new Skywake({ key: process.env.SKYWAKE_API_KEY! });`,
      python: `from skywake import Skywake

sky = Skywake()`,
      go: `import (
	"context"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

sky, err := skywake.New()
ctx := context.Background()`,
      ruby: `require "skywake"

sky = Skywake.new`,
      rust: `use skywake::Skywake;

let sky = Skywake::new()?;`,
      java: `import dev.skywake.Skywake;

Skywake sky = new Skywake();`,
      csharp: `using Skywake;

using var sky = new SkywakeClient();`,
    },
  },
  {
    slug: "fork-filesystem",
    title: "Fork a filesystem branch",
    description: "Fork a branch of a namespace. No data is copied.",
    examples: {
      typescript: `const work = await sky.disk("acme").fork("agent-42");
console.log(work.branch);`,
      python: `work = sky.disk("acme").fork("agent-42")
print(work.branch)`,
      go: `work, err := sky.Disk("acme").Fork(ctx, "agent-42")
if err != nil {
	return err
}
fmt.Println(work.Branch)`,
      ruby: `work = sky.disk("acme").fork("agent-42")
puts work.branch`,
      rust: `let work = sky.disk("acme").fork("agent-42").await?;
println!("{}", work.branch());`,
      java: `Disk work = sky.disk("acme").fork("agent-42");
System.out.println(work.branch());`,
      csharp: `var work = await sky.Disk("acme").ForkAsync("agent-42");
Console.WriteLine(work.Branch);`,
    },
  },
  {
    slug: "commit-files",
    title: "Commit files",
    description: "Write, change or remove files on a branch as one commit.",
    examples: {
      typescript: `const work = sky.disk("acme", { branch: "agent-42" });
const { commit } = await work.write({ "notes.md": "hello", "todo.md": "ship docs" }, { message: "add notes" });
await work.delete("todo.md", { message: "drop the todo" });`,
      python: `work = sky.disk("acme", branch="agent-42")
done = work.write({"notes.md": "hello", "todo.md": "ship docs"}, message="add notes")
work.delete("todo.md", message="drop the todo")`,
      go: `work := sky.Disk("acme", "agent-42")
done, err := work.WriteFiles(ctx, map[string][]byte{
	"notes.md": []byte("hello"),
	"todo.md":  []byte("ship docs"),
}, skywake.WriteOptions{Message: "add notes"})
if err != nil {
	return err
}
_, err = work.Delete(ctx, "todo.md", skywake.CommitOptions{Message: "drop the todo"})`,
      ruby: `work = sky.disk("acme", branch: "agent-42")
done = work.write({ "notes.md" => "hello", "todo.md" => "ship docs" }, message: "add notes")
work.delete("todo.md", message: "drop the todo")`,
      rust: `let work = sky.disk("acme").on("agent-42");
let done = work
    .write_files([("notes.md", "hello"), ("todo.md", "ship docs")])
    .message("add notes")
    .await?;
work.delete("todo.md").message("drop the todo").await?;`,
      java: `Disk work = sky.disk("acme", "agent-42");
Committed done = work.write(
        Map.of("notes.md", "hello", "todo.md", "ship docs"), new WriteOptions().message("add notes"));
work.delete("todo.md", "drop the todo");`,
      csharp: `var work = sky.Disk("acme", branch: "agent-42");
var done = await work.WriteAsync(
    new Dictionary<string, string> { ["notes.md"] = "hello", ["todo.md"] = "ship docs" },
    new WriteOptions { Message = "add notes" });
await work.DeleteAsync("todo.md", message: "drop the todo");`,
    },
  },
  {
    slug: "read-file",
    title: "Read a file",
    description: "Read a file from a branch, whole or a range of its bytes.",
    examples: {
      typescript: `const work = sky.disk("acme", { branch: "agent-42" });
const text = await work.read("notes.md");
const bytes = await work.read("notes.md", { as: "bytes", offset: 0, length: 5 });`,
      python: `work = sky.disk("acme", branch="agent-42")
text = work.read("notes.md")
data = work.read("notes.md", binary=True, offset=0, length=5)`,
      go: `work := sky.Disk("acme", "agent-42")
text, err := work.Read(ctx, "notes.md")
data, err := work.ReadBytes(ctx, "notes.md", skywake.ReadOptions{Offset: 0, Length: 5})`,
      ruby: `work = sky.disk("acme", branch: "agent-42")
text = work.read("notes.md")
data = work.read("notes.md", binary: true, offset: 0, length: 5)`,
      rust: `let work = sky.disk("acme").on("agent-42");
let text = work.read("notes.md").await?;
let bytes = work.read("notes.md").offset(0).length(5).bytes().await?;`,
      java: `Disk work = sky.disk("acme", "agent-42");
String text = work.read("notes.md");
byte[] bytes = work.readBytes("notes.md", new ReadOptions().offset(0).length(5));`,
      csharp: `var work = sky.Disk("acme", branch: "agent-42");
var text = await work.ReadAsync("notes.md");
var bytes = await work.ReadBytesAsync("notes.md", new ReadOptions { Offset = 0, Length = 5 });`,
    },
  },
];
