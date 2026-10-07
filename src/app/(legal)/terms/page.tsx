import { LegalDoc } from "@/components/legal/LegalDoc";
import source from "@/lib/legal/content/terms";

export const metadata = { title: "הסכם שירות ונספחים | Zapidly" };

export default function Page() {
  return (
    <>
      <h1 className="legal-title" lang="he" dir="rtl">
        הסכם שירות ונספחים
      </h1>
      <LegalDoc source={source} />
    </>
  );
}
