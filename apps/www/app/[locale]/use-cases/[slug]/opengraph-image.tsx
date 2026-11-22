import { ogImage } from "@/lib/og";

export { alt, contentType, size } from "@/lib/og";
export { generateStaticParams } from "./page";

export default ogImage("/use-cases/[slug]");
