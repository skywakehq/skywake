import {
  siDotnet,
  siGo,
  siOpenapiinitiative,
  siOpenjdk,
  siPython,
  siRuby,
  siRust,
  siTypescript,
  type SimpleIcon,
} from "simple-icons";

export type Tool = { label: string; title: string; line: string; fact: string };

export const tools: Tool[] = [
  {
    label: "MCP server",
    title: "Built for agents.",
    line: "Branches, files, merges and search as 17 tools.",
    fact: "skywake-mcp",
  },
  {
    label: "CLI",
    title: "One binary.",
    line: "Fork, mount, merge and search from a terminal.",
    fact: "npx skywake",
  },
  {
    label: "SDKs",
    title: "Seven languages.",
    line: "TypeScript, Python, Go, Rust, Ruby, Java and C#.",
    fact: "one HTTP API",
  },
  {
    label: "Console",
    title: "Watch the fleet.",
    line: "Every agent's session, claims and merges, live.",
    fact: "in your browser",
  },
];

export type Sdk = { name: string; icon: SimpleIcon; install: string };

export const sdks: Sdk[] = [
  { name: "TypeScript", icon: siTypescript, install: "npm i @skywake/sdk" },
  { name: "Python", icon: siPython, install: "pip install skywake" },
  { name: "Go", icon: siGo, install: "go get github.com/skywakehq/skywake/sdks/go" },
  { name: "Rust", icon: siRust, install: "cargo add skywake-client" },
  { name: "Ruby", icon: siRuby, install: "gem install skywake" },
  { name: "Java", icon: siOpenjdk, install: "dev.skywake:skywake" },
  { name: "C#", icon: siDotnet, install: "dotnet add package Skywake" },
  { name: "OpenAPI", icon: siOpenapiinitiative, install: "GET /v1/openapi.json" },
];
