import { pageMetadata } from "@/lib/metadata";
import { Contact, Legal } from "@/components/sections/legal";
import { SitePage } from "@/components/layout/site-page";

export const metadata = pageMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <SitePage>
      <Legal title="Privacy">
        <p>This site collects as little as it can. Here is all of it.</p>

        <h3>The Cloud waitlist</h3>
        <p>
          If you join the waitlist, we keep your email address, the note you leave (if any) and the
          time you joined. We use them for one thing: to email you once, when Skywake Cloud opens.
          We don’t share them or sell them, and we don’t add you to any other list.
        </p>

        <h3>Cookies and tracking</h3>
        <p>
          This site sets no tracking cookies and runs no analytics. Your browser keeps your light or
          dark theme choice on your own device; it never reaches us.
        </p>

        <h3>Self-hosted Skywake</h3>
        <p>
          Skywake you run yourself sends us nothing. Your files, indexes and keys stay in your own
          bucket and database.
        </p>

        <h3>Who processes it</h3>
        <p>
          The waitlist is stored in our database, and the one email is sent through our email
          provider. Both keep it only to do that job.
        </p>

        <h3>Deleting your data</h3>
        <p>
          To leave the waitlist or have your data deleted, ask through <Contact />. We delete it
          within 30 days.
        </p>
      </Legal>
    </SitePage>
  );
}
