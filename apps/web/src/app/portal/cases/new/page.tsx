import { NewCaseWizard } from './wizard';

export const metadata = { title: 'Open a case' };

export default async function NewCase({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; serial?: string }>;
}) {
  const sp = await searchParams;
  return (
    <NewCaseWizard
      initialSubject={(sp.subject ?? '').slice(0, 200)}
      initialSerial={(sp.serial ?? '').slice(0, 64)}
    />
  );
}
