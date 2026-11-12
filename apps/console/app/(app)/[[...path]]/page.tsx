import { Views } from "@/components/shell/views";

// Every console page. Only the first load comes here; the browser draws the rest,
// including addresses that match no page.
export default function Page() {
  return <Views />;
}
