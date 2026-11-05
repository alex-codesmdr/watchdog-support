/**
 * Occasional tools, grouped on one hub page each (staff: /admin, customer administrators:
 * /portal/admin) so the navigation bar stays short. Each entry shows only with its permission.
 */
export interface Tool {
  perm: string;
  href: string;
  label: string;
  desc: string;
  group: string;
}

export const STAFF_TOOLS: Tool[] = [
  {
    perm: 'case:note:internal',
    href: '/workspace/saved-replies',
    label: 'Saved replies',
    desc: 'Text you send often, ready to insert into a case reply.',
    group: 'Your tools',
  },
  {
    perm: 'report:ops:read:all',
    href: '/workspace/reports',
    label: 'Support report',
    desc: 'Volumes, speed, backlog and satisfaction across customers.',
    group: 'Reports',
  },
  {
    perm: 'report:sla:read',
    href: '/workspace/sla',
    label: 'SLA report',
    desc: 'Response and resolution targets met and missed.',
    group: 'Reports',
  },
  {
    perm: 'registration:approve',
    href: '/admin/registrations',
    label: 'Registrations',
    desc: 'Approve or decline new customer organisations.',
    group: 'Customers',
  },
  {
    perm: 'asset:import',
    href: '/admin/imports',
    label: 'Device import',
    desc: 'Register customer devices and coverage from a spreadsheet.',
    group: 'Customers',
  },
  {
    perm: 'advisory:manage',
    href: '/admin/advisories',
    label: 'Security advisories',
    desc: 'Write, publish, revise and withdraw advisories.',
    group: 'Content',
  },
  {
    perm: 'release:manage',
    href: '/admin/releases',
    label: 'Releases',
    desc: 'Firmware, software and documents in the download centre.',
    group: 'Content',
  },
  {
    perm: 'kb:draft',
    href: '/workspace/kb',
    label: 'Knowledge base editor',
    desc: 'Draft, review and publish articles.',
    group: 'Content',
  },
  {
    perm: 'settings:manage',
    href: '/admin/settings',
    label: 'Portal settings',
    desc: 'Support phone numbers, emails, hours, and features to switch on or off.',
    group: 'Portal',
  },
  {
    perm: 'routing:manage',
    href: '/admin/routing',
    label: 'Case routing',
    desc: 'Rules that send new cases to the right queue and engineers.',
    group: 'Portal',
  },
  {
    perm: 'announcement:manage',
    href: '/admin/announcements',
    label: 'Announcements',
    desc: 'Banners for maintenance windows and important notices.',
    group: 'Portal',
  },
  {
    perm: 'audit:read:all',
    href: '/admin/audit',
    label: 'Audit trail',
    desc: 'Every recorded change, with a tamper check.',
    group: 'Portal',
  },
];

export const CUSTOMER_ADMIN_TOOLS: Tool[] = [
  {
    perm: 'report:ops:read:org',
    href: '/portal/reports',
    label: 'Support report',
    desc: 'Your cases: volumes, speed, backlog and satisfaction.',
    group: 'Your organisation',
  },
  {
    perm: 'org:users:manage',
    href: '/portal/team',
    label: 'Your team',
    desc: 'Add colleagues, make them administrators, or switch off their access.',
    group: 'Your organisation',
  },
  {
    perm: 'audit:read:org',
    href: '/portal/activity',
    label: 'Activity log',
    desc: 'What your people, and WatchDog Support for you, did in the portal.',
    group: 'Your organisation',
  },
  {
    perm: 'integration:manage',
    href: '/portal/integrations',
    label: 'API keys and webhooks',
    desc: 'Connect your ticketing or monitoring system.',
    group: 'Your organisation',
  },
];

export const toolsFor = (tools: Tool[], permissions: string[]) =>
  tools.filter((t) => permissions.includes(t.perm));
