import Link from "next/link";

import { SitePage } from "@/components/layout/site-page";
import { Container, SectionHead } from "@/components/ui/section";

export default function NotFound() {
  return (
    <SitePage>
      <SectionHead
        label="404"
        title={
          <>
            Nothing here. <span className="text-muted-foreground">This page doesn’t exist.</span>
          </>
        }
      />
      <Container>
        <Link href="/" className="btn btn-primary">
          Back to the home page
        </Link>
      </Container>
    </SitePage>
  );
}
