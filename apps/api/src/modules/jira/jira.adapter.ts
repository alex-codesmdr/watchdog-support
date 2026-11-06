import { logger } from '../../common/logger.js';
import type { AppConfig } from '../../config.js';

export interface JiraIssueInput {
  summary: string;
  description: string;
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
  labels: string[];
}
export interface JiraIssue {
  key: string;
  url: string;
  status: string;
  /** Jira's status category: new (To Do), indeterminate (In Progress) or done. */
  category: 'new' | 'indeterminate' | 'done';
}

/** The engineering tracker the support team escalates product defects to. */
export interface JiraAdapter {
  readonly name: string;
  create(issue: JiraIssueInput): Promise<JiraIssue>;
  get(key: string): Promise<JiraIssue | null>;
}

/** In-memory tracker for development and tests; `advance` simulates engineering progress. */
export class MockJira implements JiraAdapter {
  readonly name = 'Engineering tracker (demo)';
  private seq = 100;
  readonly issues = new Map<string, JiraIssue & JiraIssueInput>();
  constructor(private readonly project = 'WDENG') {}

  async create(i: JiraIssueInput): Promise<JiraIssue> {
    const key = `${this.project}-${++this.seq}`;
    const issue = {
      ...i,
      key,
      url: `https://tracker.watchdog.example/browse/${key}`,
      status: 'To Do',
      category: 'new' as const,
    };
    this.issues.set(key, issue);
    logger.info({ key }, '[mock] engineering issue created');
    return issue;
  }
  async get(key: string) {
    return this.issues.get(key) ?? null;
  }
  advance(key: string, status: string, category: JiraIssue['category']) {
    const i = this.issues.get(key);
    if (i) this.issues.set(key, { ...i, status, category });
  }
}

/** Jira Cloud REST v3 with an API token. */
export class JiraCloud implements JiraAdapter {
  readonly name = 'Jira';
  constructor(private readonly cfg: AppConfig) {
    if (!cfg.JIRA_BASE_URL?.startsWith('https://') || !cfg.JIRA_EMAIL || !cfg.JIRA_API_TOKEN)
      throw new Error('JIRA_MODE=cloud needs JIRA_BASE_URL (https), JIRA_EMAIL and JIRA_API_TOKEN');
  }
  private headers() {
    return {
      authorization: `Basic ${Buffer.from(`${this.cfg.JIRA_EMAIL}:${this.cfg.JIRA_API_TOKEN}`).toString('base64')}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }
  private base() {
    return this.cfg.JIRA_BASE_URL!.replace(/\/$/, '');
  }

  async create(i: JiraIssueInput): Promise<JiraIssue> {
    const r = await fetch(`${this.base()}/rest/api/3/issue`, {
      method: 'POST',
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        fields: {
          project: { key: this.cfg.JIRA_PROJECT_KEY },
          issuetype: { name: 'Bug' },
          summary: i.summary.slice(0, 250),
          priority: { name: i.priority },
          labels: i.labels,
          description: {
            type: 'doc',
            version: 1,
            content: i.description.split(/\n{2,}/).map((para) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: para.slice(0, 30_000) }],
            })),
          },
        },
      }),
    });
    if (!r.ok) throw new Error(`Jira create failed: HTTP ${r.status}`);
    const { key } = (await r.json()) as { key: string };
    return (
      (await this.get(key)) ?? {
        key,
        url: `${this.base()}/browse/${key}`,
        status: 'To Do',
        category: 'new',
      }
    );
  }

  async get(key: string): Promise<JiraIssue | null> {
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) return null;
    const r = await fetch(`${this.base()}/rest/api/3/issue/${key}?fields=status`, {
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Jira read failed: HTTP ${r.status}`);
    const b = (await r.json()) as {
      key: string;
      fields: { status: { name: string; statusCategory: { key: string } } };
    };
    const cat = b.fields.status.statusCategory.key;
    return {
      key: b.key,
      url: `${this.base()}/browse/${b.key}`,
      status: b.fields.status.name,
      category: cat === 'done' ? 'done' : cat === 'indeterminate' ? 'indeterminate' : 'new',
    };
  }
}
