"use server";
import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/server/config";
export async function login(formData: FormData) {
  if (!authConfigured()) redirect("/topsdlsodo?error=Configuration");
  try {
    await signIn("credentials", { email: formData.get("email"), password: formData.get("password"), redirectTo: "/topsdlsodo" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/topsdlsodo?error=CredentialsSignin");
    throw error;
  }
}
export async function logout() { await signOut({ redirectTo: "/topsdlsodo" }); }
