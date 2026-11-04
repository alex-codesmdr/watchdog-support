'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RELEASE_KIND_LABELS, type ReleaseView } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';
import type { ReleaseMeta } from './meta';

const VIS = [
  ['entitled', 'Covered customers (active contract on a listed model)'],
  ['registered', 'Any signed-in customer or partner'],
  ['public', 'Everyone, without signing in'],
  ['internal', 'WatchDog staff only'],
] as const;

export function ReleaseForm({ meta, release }: { meta: ReleaseMeta; release?: ReleaseView }) {
  const router = useRouter();
  const [f, setF] = useState({
    familyKey: release?.family.key ?? meta.families[0]?.key ?? '',
    kind: release?.kind ?? 'firmware',
    title: release?.title ?? '',
    version: release?.version ?? '',
    visibility: release?.visibility ?? 'entitled',
    recommended: release?.recommended ?? false,
    releasedOn: release?.releasedOn ?? '',
    notesMd: release?.notesMd ?? '',
    productSkus: release?.products.map((p) => p.sku) ?? ([] as string[]),
    eulaVersion: release?.eula?.version ?? meta.eulas[0]?.version ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fam = meta.families.find((x) => x.key === f.familyKey);
  const models = meta.products.filter((p) => p.familyId === fam?.id);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF({ ...f, [k]: v });
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      ...f,
      releasedOn: f.releasedOn || null,
      eulaVersion: f.eulaVersion || null,
      productSkus: f.productSkus.filter((s) => models.some((m) => m.sku === s)),
    };
    try {
      const r = await apiFetch<ReleaseView>(
        release ? `/v1/admin/releases/${release.id}` : '/v1/admin/releases',
        { method: release ? 'PUT' : 'POST', body },
      );
      if (release) {
        setSaved(true);
        router.refresh();
      } else router.push(`/admin/releases/${r.id}`);
    } catch (e) {
      setErr(
        e instanceof ClientApiError
          ? (e.errors?.map((x) => x.message).join('; ') ?? e.detail ?? e.title)
          : 'The release could not be saved',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {err && <Notice tone="error">{err}</Notice>}
      {saved && <Notice tone="success">Saved.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product family" required>
          {(p) => (
            <Select {...p} value={f.familyKey} onChange={(e) => set('familyKey', e.target.value)}>
              {meta.families.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type" required>
          {(p) => (
            <Select
              {...p}
              value={f.kind}
              onChange={(e) => set('kind', e.target.value as ReleaseView['kind'])}
            >
              {Object.entries(RELEASE_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" required hint="For example: CoreLink OS">
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
            />
          )}
        </Field>
        <Field label="Version" required hint="Letters, digits, dots, hyphens">
          {(p) => (
            <Input
              {...p}
              maxLength={40}
              className="font-mono"
              value={f.version}
              onChange={(e) => set('version', e.target.value)}
            />
          )}
        </Field>
        <Field label="Who can download" required>
          {(p) => (
            <Select
              {...p}
              value={f.visibility}
              onChange={(e) => set('visibility', e.target.value as ReleaseView['visibility'])}
            >
              {VIS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Release date">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={f.releasedOn}
              onChange={(e) => set('releasedOn', e.target.value)}
            />
          )}
        </Field>
        <Field label="Licence agreement">
          {(p) => (
            <Select
              {...p}
              value={f.eulaVersion}
              onChange={(e) => set('eulaVersion', e.target.value)}
            >
              <option value="">None</option>
              {meta.eulas.map((x) => (
                <option key={x.id} value={x.version}>
                  {x.title} ({x.version})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={f.recommended}
            onChange={(e) => set('recommended', e.target.checked)}
          />
          Recommended release
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Compatible models</legend>
        <p className="text-xs text-muted">
          Leave all unticked if the release suits every model in the family.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {models.map((m) => (
            <label key={m.sku} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={f.productSkus.includes(m.sku)}
                onChange={(e) =>
                  set(
                    'productSkus',
                    e.target.checked
                      ? [...f.productSkus, m.sku]
                      : f.productSkus.filter((s) => s !== m.sku),
                  )
                }
              />
              {m.modelName}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Release notes" hint="Markdown. Shown with the release.">
        {(p) => (
          <Textarea
            {...p}
            className="min-h-48 font-mono text-sm"
            value={f.notesMd}
            onChange={(e) => set('notesMd', e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" busy={busy} disabled={!f.title.trim() || !f.version.trim()}>
        {release ? 'Save changes' : 'Create draft'}
      </Button>
    </form>
  );
}
