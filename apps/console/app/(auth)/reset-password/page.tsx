import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResetPassword } from "@/features/auth/password-reset";
import { EMAIL } from "@/server/hosted";

export default function Page() {
  if (!EMAIL) notFound();
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
