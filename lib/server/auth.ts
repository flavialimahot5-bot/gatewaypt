import { auth } from "@/auth";
import { authConfigured } from "./config";
export async function getCurrentUser() {
  if (!authConfigured()) return null;
  const session = await auth();
  if (!session?.user?.email) return null;
  return {
    userId: session.user.email.toLowerCase(),
    email: session.user.email,
    fullName: session.user.name || null,
  };
}
