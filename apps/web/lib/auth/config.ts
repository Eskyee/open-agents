import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

function normalizeHost(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    ).host;
  } catch {
    return null;
  }
}

function getWildcardHostPattern(host: string): string | null {
  const hostname = host.split(":")[0];
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("[")
  ) {
    return null;
  }

  return `*.${host}`;
}

function getAuthBaseURLFallback(): string | undefined {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
  );
}

function getAllowedAuthHosts(): string[] {
  const hosts = new Set<string>(["localhost:3000", "127.0.0.1:3000"]);

  for (const value of [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    const host = normalizeHost(value);
    if (!host) {
      continue;
    }

    hosts.add(host);

    const wildcardPattern = getWildcardHostPattern(host);
    if (wildcardPattern) {
      hosts.add(wildcardPattern);
    }
  }

  return [...hosts];
}

const authBaseURLFallback = getAuthBaseURLFallback();
const authAllowedHosts = getAllowedAuthHosts();

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: {
    allowedHosts: authAllowedHosts,
    ...(authBaseURLFallback ? { fallback: authBaseURLFallback } : {}),
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: schema.users,
      auth_sessions: schema.authSessions,
      account: schema.accounts,
      verification: schema.verification,
    },
  }),

  user: {
    modelName: "users",
    fields: {
      image: "avatarUrl",
    },
    additionalFields: {
      // Not required: OAuth providers (Vercel/GitHub) don't return a username,
      // so requiring it here makes Better Auth reject user creation with
      // "unable_to_create_user". We derive it from the email instead (see the
      // user.create.before hook below).
      username: { type: "string", required: false },
      lastLoginAt: { type: "date", required: false },
    },
  },

  session: {
    modelName: "auth_sessions",
  },

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["vercel", "github"],
      allowDifferentEmails: true,
    },
  },

  socialProviders: {
    vercel: {
      clientId: process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID ?? "",
      clientSecret: process.env.VERCEL_APP_CLIENT_SECRET ?? "",
      scope: ["openid", "email", "profile", "offline_access"],
      overrideUserInfoOnSignIn: true,
    },
    github: {
      clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },

  advanced: {
    database: {
      generateId: () => nanoid(),
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // OAuth providers don't supply a username, so derive a safe one from
          // the email before the row is inserted. Without this the user is
          // created with an empty username (the column default).
          const u = user as { username?: string; email?: string };
          if (!u.username && u.email) {
            const username = u.email
              .split("@")[0]
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            return { data: { ...user, username } };
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
            .split(",")
            .map((e: string) => e.trim().toLowerCase())
            .filter(Boolean);
          if (allowedEmails.length > 0) {
            const email = (session.user as any)?.email?.toLowerCase() ?? "";
            if (email && !allowedEmails.includes(email)) {
              throw new Error("Access denied: email not allowed");
            }
          }
          // Generate username from email if not set
          const user = session.user as any;
          if (user && !user.username && user.email) {
            const username = user.email
              .split("@")[0]
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            await db
              .update(users)
              .set({ username })
              .where(eq(users.id, user.id));
          }
        },
      },
    },
  },
});
