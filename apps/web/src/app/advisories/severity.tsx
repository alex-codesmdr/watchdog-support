import { ADVISORY_SEVERITY_LABELS, type AdvisorySeverity } from '@wd/contracts';
import { cn } from '@wd/ui';

/**
 * Severity as a filled bar of five segments plus the word, so it reads without colour too.
 * Colours follow the CVSS bands but stay within the portal palette.
 */
const LEVEL: Record<AdvisorySeverity, number> = {
  informational: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};
const TONE: Record<AdvisorySeverity, string> = {
  informational: 'bg-muted',
  low: 'bg-teal',
  medium: 'bg-amber',
  high: 'bg-danger/80',
  critical: 'bg-danger',
};

export function Severity({
  value,
  score,
  className,
}: {
  value: AdvisorySeverity;
  score?: number | null;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn('h-3 w-1.5 rounded-[1px]', i <= LEVEL[value] ? TONE[value] : 'bg-line')}
          />
        ))}
      </span>
      <span className="font-semibold">{ADVISORY_SEVERITY_LABELS[value]}</span>
      {score != null && <span className="text-muted tabular-nums">CVSS {score.toFixed(1)}</span>}
    </span>
  );
}
