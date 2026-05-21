import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/auth`
    : "/api/auth";

export const authClient = createAuthClient({ baseURL });

export const { useSession, signIn, signOut, signUp } = authClient;
