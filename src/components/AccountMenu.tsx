"use client";

import { UserButton } from "@clerk/nextjs";

export function AccountMenu({
  accountLabel,
  signOutLabel,
  legalLabel,
}: {
  accountLabel: string;
  signOutLabel: string;
  /** Extra item in the avatar menu: the legal documents page (/legal). */
  legalLabel: string;
}) {
  return (
    <div className="sidebar-account">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "sidebar-account-avatar",
          },
        }}
      >
        <UserButton.MenuItems>
          <UserButton.Link
            label={legalLabel}
            href="/legal"
            labelIcon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
            }
          />
        </UserButton.MenuItems>
      </UserButton>
      <div className="sidebar-account-meta">
        <span className="sidebar-account-label">{accountLabel}</span>
        <span className="sidebar-account-hint">{signOutLabel}</span>
      </div>
    </div>
  );
}
