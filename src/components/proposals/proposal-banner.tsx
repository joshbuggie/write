import { Notice } from "@/components/note/notice";
import { Button } from "@/components/ui/button";
import type { ProposalSummary } from "@/lib/proposals/types";
import { bannerText } from "./review-labels";

type ProposalBannerProps = { proposals: ProposalSummary[]; onReview: (id: string) => void };

/**
 * Above the note: which harness proposed changes to it, and a way into the review
 * (docs/design-decisions.md#d31). One line per proposal waiting; usually there is one.
 */
export function ProposalBanner({ proposals, onReview }: ProposalBannerProps) {
  return (
    <>
      {proposals.map((p) => (
        <Notice
          key={p.id}
          actions={
            <Button size="sm" variant="primary" onClick={() => onReview(p.id)}>
              Review changes
            </Button>
          }
        >
          {bannerText(p)}
          {p.summary && <span className="text-muted"> “{p.summary}”</span>}
        </Notice>
      ))}
    </>
  );
}
