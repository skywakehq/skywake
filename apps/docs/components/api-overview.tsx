import { openapi } from "@/lib/openapi";

/** The document's own summary: base path and how to authenticate. */
export async function ApiOverview() {
  const document = (await openapi.getSchema("skywake")).bundled;
  const { info, servers } = document;
  return (
    <>
      <p>{info?.description}</p>
      <ul>
        <li>
          Base path: <code>{servers?.[0]?.url ?? "/"}</code>
        </li>
        <li>
          OpenAPI {document.openapi}, version <code>{info?.version}</code>
        </li>
      </ul>
    </>
  );
}
