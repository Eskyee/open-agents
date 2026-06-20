"use client";

import { SignInButton } from "@/components/auth/sign-in-button";

export function SignedOutHero() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
      <SignInButton size="lg" callbackUrl="/sessions" />
    </div>
  );
}
