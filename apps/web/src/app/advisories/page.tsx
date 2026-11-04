import { LaterPage } from '@/components/later';

export const metadata = { title: 'Security advisories' };

export default function AdvisoriesPage() {
  return (
    <LaterPage title="Security advisories">
      <p>
        WatchDog security advisories and field notices will be published here with CVE IDs, CVSS
        scores and fixed versions. To report a vulnerability now, email psirt@watchdog.example (PGP
        key on request).
      </p>
    </LaterPage>
  );
}
