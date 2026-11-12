import { DocsShell } from "@/components/shell/docs-shell";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/">) {
  return <DocsShell tree={source.getPageTree()}>{children}</DocsShell>;
}
