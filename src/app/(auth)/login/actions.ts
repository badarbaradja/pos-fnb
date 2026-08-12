"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { id } from "@/lib/i18n/id";

export type LoginState = {
  error?: string;
};

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email ||
    !password
  ) {
    return { error: id.common.requiredField };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: id.auth.loginError };
  }

  redirect("/");
}
