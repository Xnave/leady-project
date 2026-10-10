import { LegalDoc } from "@/components/legal/LegalDoc";
import source from "@/lib/legal/content/privacy";

export const metadata = { title: "מדיניות פרטיות | Zapidly" };

export default function Page() {
  return (
    <>
      <h1 className="legal-title" lang="he" dir="rtl">
        מדיניות פרטיות
      </h1>
      <LegalDoc source={source} />
    </>
  );
}
