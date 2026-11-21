import { Database } from "lucide-react";
import { siCloudflare, siGooglecloudstorage, siMinio } from "simple-icons";

import { Brand } from "@/components/ui/badge";

/** The object stores Skywake runs on, as the docs list them. */
export const STORES = [
  { name: "AWS S3", tile: "#569a31", mark: <Database className="size-4 text-white" /> },
  { name: "Cloudflare R2", tile: "#f38020", mark: <Brand path={siCloudflare.path} /> },
  {
    name: "Google Cloud Storage",
    tile: "#4285f4",
    mark: <Brand path={siGooglecloudstorage.path} />,
  },
  { name: "MinIO", tile: "#c72e49", mark: <Brand path={siMinio.path} /> },
  { name: "RustFS", tile: "#2b2b2b", mark: <Database className="size-4 text-white" /> },
];
