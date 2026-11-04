import { LaterPage } from '@/components/later';

export const metadata = { title: 'Check warranty' };

export default function WarrantyPage() {
  return (
    <LaterPage title="Check warranty">
      <p>
        The public serial-number lookup opens shortly. Signed-in customers can already see coverage
        for every registered device on their dashboard.
      </p>
    </LaterPage>
  );
}
