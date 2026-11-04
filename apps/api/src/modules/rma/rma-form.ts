import PDFDocument from 'pdfkit';
import { RMA_STATUS_LABELS, RMA_TYPE_LABELS, type RmaView } from '@wd/contracts';

export interface FormSection {
  heading: string;
  rows: Array<[string, string]>;
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));

/** The form's content, separate from layout so it can be checked (brand, completeness) in tests. */
export function rmaFormContent(
  r: RmaView,
  returnAddress: string,
): {
  title: string;
  sections: FormSection[];
  instructions: string[];
  footer: string;
} {
  return {
    title: `Return Material Authorisation ${r.number}`,
    sections: [
      {
        heading: 'Reference',
        rows: [
          ['RMA number', r.number],
          ['Support case', r.caseNumber],
          ['Issued', fmtDate(r.createdAt)],
          ['Type', RMA_TYPE_LABELS[r.type]],
          ['Status', RMA_STATUS_LABELS[r.status]],
        ],
      },
      {
        heading: 'Device being returned',
        rows: [
          ['Model', r.modelName],
          ['Serial number', r.serialNumber],
          ['Reported fault', r.faultDescription],
        ],
      },
      {
        heading: 'Customer',
        rows: [
          ['Organisation', r.org.name],
          ['Contact', `${r.shipTo.contactName}, ${r.shipTo.contactPhone}`],
          [
            'Replacement ships to',
            `${r.shipTo.address}, ${r.shipTo.city}, ${r.shipTo.state} ${r.shipTo.pincode}`,
          ],
        ],
      },
    ],
    instructions: [
      'Back up the configuration and remove any SFP modules or cards you want to keep.',
      'Pack the faulty unit in its original box or equivalent anti-static packaging.',
      `Write ${r.number} clearly on the outside of the box and put a printed copy of this form inside.`,
      `Send it to: ${returnAddress}.`,
      'Enter the courier name and tracking number on the RMA page so we can follow the shipment.',
    ],
    footer: 'WatchDog Support. WatchDog is a brand of Apollo Infoways Pvt. Ltd.',
  };
}

/** Renders the RMA form as an A4 PDF (standard PDF fonts: no font files, works offline). */
export function renderRmaForm(r: RmaView, returnAddress: string): Promise<Buffer> {
  const c = rmaFormContent(r, returnAddress);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: c.title,
      Author: 'WatchDog Support',
      Creator: 'WatchDog Support',
      Producer: 'WatchDog Support',
      Subject: `RMA for ${r.modelName}, serial ${r.serialNumber}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const navy = '#0B2545';
  const muted = '#5B6676';
  const width = doc.page.width - 112;
  doc.fillColor(navy).font('Helvetica-Bold').fontSize(20).text('WatchDog', { continued: true });
  doc.font('Helvetica').text(' Support');
  doc.moveDown(0.6).fontSize(15).font('Helvetica-Bold').text('Return Material Authorisation');
  doc.fontSize(12).font('Helvetica').fillColor(muted).text(r.number).moveDown(1);

  for (const s of c.sections) {
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text(s.heading, 56, doc.y);
    doc
      .moveTo(56, doc.y + 2)
      .lineTo(56 + width, doc.y + 2)
      .strokeColor('#D5DBE3')
      .stroke();
    doc.moveDown(0.5);
    for (const [k, v] of s.rows) {
      const y = doc.y;
      doc.fillColor(muted).font('Helvetica').fontSize(10).text(k, 56, y, { width: 140 });
      doc.fillColor('#111827').text(v, 200, y, { width: width - 144 });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.8);
  }

  doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('How to return the faulty unit', 56);
  doc.moveDown(0.4);
  c.instructions.forEach((line, i) => {
    doc
      .fillColor('#111827')
      .font('Helvetica')
      .fontSize(10)
      .text(`${i + 1}.  ${line}`, 56, doc.y, {
        width,
      });
    doc.moveDown(0.3);
  });

  doc
    .fontSize(8)
    .fillColor(muted)
    .text(c.footer, 56, doc.page.height - 80, { width, align: 'center' });
  doc.end();
  return done;
}
