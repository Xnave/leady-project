"use client";

import { useAuth, useClerk, useOrganizationList } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Activates the Leady tenant org when the server provides `organizationId`.
 * Platform admins with no org stay on /admin — never bounce them to /activating.
 */
export function EnsureActiveOrg({
  isPlatformAdmin,
  organizationId = null,
}: {
  isPlatformAdmin: boolean;
  organizationId?: string | null;
}) {
  const { isLoaded: authLoaded, orgId, userId } = useAuth();
  const { session } = useClerk();
  const { isLoaded, setActive } = useOrganizationList();
  const router = useRouter();
  const pathname = usePathname();
  const activatingRef = useRef(false);

  useEffect(() => {
    if (!authLoaded || !isLoaded || !userId) return;

    // Platform admin console does not require an active org.
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return;

    // Server-chosen Leady org wins over whatever is currently active.
    if (organizationId && orgId !== organizationId) {
      if (activatingRef.current) return;
      activatingRef.current = true;
      void (async () => {
        try {
          await session?.reload();
          await setActive?.({ organization: organizationId });
          router.replace("/");
          router.refresh();
        } catch {
          activatingRef.current = false;
        }
      })();
      return;
    }

    if (organizationId && orgId === organizationId) {
      if (pathname === "/activating") {
        router.replace("/");
        router.refresh();
      }
      return;
    }

    // Already in some org — leave it; pages that need a Leady tenant redirect themselves.
    if (orgId) return;

    if (
      pathname === "/activating" ||
      pathname === "/no-access" ||
      pathname === "/sign-in" ||
      pathname.startsWith("/sign-in")
    ) {
      if (pathname === "/activating" && !organizationId) {
        if (isPlatformAdmin) router.replace("/admin");
        else router.replace("/no-access");
      }
      return;
    }

    // CRM route without an active org.
    if (isPlatformAdmin) {
      router.replace("/admin");
      return;
    }
    router.replace("/activating");
  }, [
    authLoaded,
    isLoaded,
    userId,
    orgId,
    organizationId,
    session,
    setActive,
    router,
    pathname,
    isPlatformAdmin,
  ]);

  return null;
}
