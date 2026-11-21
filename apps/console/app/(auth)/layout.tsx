import { connection } from "next/server";
import { AuthOptionsProvider } from "@/features/auth/options";
import { AuthFrame } from "@/features/auth/auth-frame";
import { authOptions } from "@/server/hosted";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // What these pages offer depends on settings read when the server runs.
  await connection();
  return (
    <AuthFrame>
      <AuthOptionsProvider value={authOptions()}>{children}</AuthOptionsProvider>
    </AuthFrame>
  );
}
