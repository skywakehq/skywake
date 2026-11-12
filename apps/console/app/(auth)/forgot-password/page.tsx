import { notFound } from "next/navigation";
import { ForgotPassword } from "@/features/auth/password-reset";
import { EMAIL } from "@/server/hosted";

export default function Page() {
  if (!EMAIL) notFound();
  return <ForgotPassword />;
}
