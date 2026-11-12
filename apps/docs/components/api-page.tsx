"use client";

import { createOpenAPIPage } from "fumadocs-openapi/ui";
import { preload } from "react-dom";
import { basePath } from "@/lib/zone";

export const OpenAPIPage = createOpenAPIPage({
  async loadDocument(id) {
    const url = `${basePath}/api/openapi/${id}`;
    if (typeof window === "undefined") {
      preload(url, { as: "fetch", crossOrigin: "anonymous" });
      const { openapi } = await import("@/lib/openapi");
      return (await openapi.getSchema(id)).bundled;
    }
    return (await fetch(url)).json();
  },
});
