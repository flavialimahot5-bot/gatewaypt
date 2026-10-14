import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticatePassword, credentialVersion } from "@/lib/server/password";
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: !!process.env.VERCEL || process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV === "development",
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [Credentials({
    credentials: { email: { type: "email" }, password: { type: "password" } },
    authorize: authenticatePassword,
  })],
  pages: { signIn: "/topsdlsodo", error: "/topsdlsodo" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.credentialVersion = (user as typeof user & {credentialVersion: string}).credentialVersion;
      return token;
    },
    session({ session, token }) {
      const email = session.user?.email?.toLowerCase();
      const version = email ? credentialVersion(email) : null;
      if (!version || token.credentialVersion !== version)
        return { ...session, user: undefined as any };
      return session;
    },
    redirect() { return new URL("/topsdlsodo", process.env.APP_ORIGIN || "http://localhost:5173").href; },
  },
});
