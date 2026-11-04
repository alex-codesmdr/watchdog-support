import { LaterPage } from '@/components/later';

export const metadata = { title: 'Downloads' };

export default function DownloadsPage() {
  return (
    <LaterPage title="Downloads">
      <p>
        Firmware, software, release notes, MIBs and compliance documents will be listed here with
        SHA-256 checksums once the download centre opens. Until then, your engineer can send the
        right image from your case.
      </p>
    </LaterPage>
  );
}
