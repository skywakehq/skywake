import { pageMetadata } from "@/lib/metadata";
import { Contact, Legal } from "@/components/sections/legal";
import { SitePage } from "@/components/layout/site-page";

export const metadata = pageMetadata("/terms");

export default function TermsPage() {
  return (
    <SitePage>
      <Legal title="Terms">
        <h3>The software</h3>
        <p>
          Skywake is open source under the Apache License 2.0. That license, not this page, sets
          what you may do with the code. It comes as is, without warranty.
        </p>

        <h3>This site</h3>
        <p>
          You may read, link to and share this site. Don’t try to break it, overload it or sign up
          other people to the waitlist.
        </p>

        <h3>Numbers we publish</h3>
        <p>
          Benchmarks on this site were measured on the hardware and setup we describe with them.
          Your results will depend on yours.
        </p>

        <h3>Skywake Cloud</h3>
        <p>
          Cloud isn’t open yet. It will have its own terms, which you’ll see before you sign up.
        </p>

        <h3>Changes and questions</h3>
        <p>
          We may update these terms; the date at the top shows when. Questions go through{" "}
          <Contact />.
        </p>
      </Legal>
    </SitePage>
  );
}
