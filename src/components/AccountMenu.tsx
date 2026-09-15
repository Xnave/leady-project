"use client";

import { UserButton } from "@clerk/nextjs";

export function AccountMenu({
  accountLabel,
  signOutLabel,
}: {
  accountLabel: string;
  signOutLabel: string;
}) {
  return (
    <div className="sidebar-account">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "sidebar-account-avatar",
          },
        }}
      />
      <div className="sidebar-account-meta">
        <span className="sidebar-account-label">{accountLabel}</span>
        <span className="sidebar-account-hint">{signOutLabel}</span>
      </div>
    </div>
  );
}
