import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  SeverityBadge,
  SlaBar,
  Skeleton,
  StatusPill,
  Textarea,
  Wordmark,
} from '../components.js';

const meta: Meta = { title: 'Design system/Components' };
export default meta;
type S = StoryObj;

export const Buttons: S = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Open case</Button>
      <Button variant="secondary">Back</Button>
      <Button variant="ghost">Escalate to L2</Button>
      <Button variant="danger">Reject</Button>
      <Button busy>Saving</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};

export const Fields: S = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <Field label="Serial number" required hint="Printed on the device label.">
        {(p) => <Input {...p} className="font-mono" defaultValue="WDSW5600A0001" />}
      </Field>
      <Field label="Subject" required error="Describe the problem in at least 8 characters.">
        {(p) => <Input {...p} defaultValue="BGP" />}
      </Field>
      <Field label="What is happening?">{(p) => <Textarea {...p} />}</Field>
    </div>
  ),
};

export const Severity: S = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {['P1', 'P2', 'P3', 'P4'].map((s) => (
        <SeverityBadge key={s} severity={s} />
      ))}
      <StatusPill label="In Progress" open />
      <StatusPill label="Closed" open={false} />
    </div>
  ),
};

const dueIn = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
export const SlaBars: S = {
  name: 'SLA budget bars',
  render: () => (
    <div className="grid max-w-sm gap-5">
      <SlaBar
        label="First response"
        percent={30}
        remainingSeconds={630}
        met={false}
        paused={false}
        dueAt={dueIn(10)}
      />
      <SlaBar
        label="Restore service"
        percent={80}
        remainingSeconds={2880}
        met={false}
        paused={false}
        dueAt={dueIn(48)}
      />
      <SlaBar
        label="Next update"
        percent={104}
        remainingSeconds={-240}
        met={false}
        paused={false}
        dueAt={dueIn(-4)}
      />
      <SlaBar
        label="Resolution"
        percent={40}
        remainingSeconds={50000}
        met={false}
        paused
        dueAt={dueIn(900)}
      />
      <SlaBar
        label="First response"
        percent={20}
        remainingSeconds={700}
        met
        paused={false}
        dueAt={dueIn(-60)}
      />
    </div>
  ),
};

export const States: S = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      <Notice tone="success" title="Case WD-2026-000123 is open">
        We emailed you a confirmation.
      </Notice>
      <Notice tone="warning">This device has no active support contract.</Notice>
      <Notice tone="error">That did not work. Try again.</Notice>
      <EmptyState title="No open cases" action={<Button>Open a case</Button>}>
        When something needs attention, open a case and the SLA clock starts immediately.
      </EmptyState>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  ),
};

export const DialogStory: S = {
  name: 'Dialog',
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Escalate</Button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Escalate to WatchDog management">
          <p className="text-sm">A support manager reviews every escalation.</p>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </Dialog>
      </>
    );
  },
};

export const Brand: S = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Wordmark />
      <div className="bg-navy p-4">
        <Wordmark inverted />
      </div>
    </div>
  ),
};
