// The MCP server's registry entry, where agents and directories look for it on the site.
import server from "../../../../../../packages/skywake/server.json";

export function GET() {
  return Response.json(server, { headers: { "access-control-allow-origin": "*" } });
}
