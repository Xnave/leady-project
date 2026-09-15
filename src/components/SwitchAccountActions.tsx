"use client";

import { SignOutButton, useAuth } from "@clerk/nextjs";

export function SwitchAccountActions({
  switchLabel,
  signOutLabel,
}: {
  switchLabel: string;
  signOutLabel: string;
}) {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded || !userId) return null;

  return (
    <div className="auth-message-actions">
      <SignOutButton redirectUrl="/sign-in">
        <button type="button" className="btn-secondary">
          {signOutLabel}
        </button>
      </SignOutButton>
      <p className="muted" style={{ flexBasis: "100%", margin: 0 }}>
        {switchLabel}
      </p>
    </div>
  );
}
