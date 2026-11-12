import { pageMetadata } from "@/lib/metadata";

import { SitePage } from "@/components/layout/site-page";
import { GetStarted } from "@/components/sections/get-started";
import { UseCase, UseCaseIndex } from "@/components/sections/use-case";
import { useCases } from "@/content/use-cases";

export const metadata = pageMetadata("/use-cases");

export default function UseCasesPage() {
  return (
    <SitePage>
      <UseCaseIndex />
      {useCases.map((useCase, i) => (
        <UseCase key={useCase.id} useCase={useCase} index={i} />
      ))}
      <GetStarted />
    </SitePage>
  );
}
