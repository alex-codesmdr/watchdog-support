import { portalSettings } from '@/lib/settings';
import { NewCaseWizard } from './wizard';

export const metadata = { title: 'Open a case' };

export default async function NewCase({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; serial?: string }>;
}) {
  const [sp, cfg] = await Promise.all([searchParams, portalSettings()]);
  return (
    <NewCaseWizard
      p1Phone={cfg.p1Phone}
      initialSubject={(sp.subject ?? '').slice(0, 200)}
      initialSerial={(sp.serial ?? '').slice(0, 64)}
    />
  );
}
